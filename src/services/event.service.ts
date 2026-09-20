import { prisma } from '../config/database';
import { Prisma, EventStatus, BookingStatus } from '@prisma/client';
import { AppError, ErrorCodes } from '../middleware/error.middleware';
import { CreateEventInput, UpdateEventInput, ListEventsQuery } from '../validators/event.validator';
import { cacheService, CACHE_TTL } from '../utils/cache';
import { enqueueEventUpdateBroadcastBatch } from '../jobs/notificationQueue';
import { logger } from '../utils/logger';

export class EventService {
  /**
   * Create a new event (Organizer only)
   * availableTickets is strictly initialized from totalCapacity
   */
  public async createEvent(organizerId: string, input: CreateEventInput) {
    const event = await prisma.event.create({
      data: {
        organizerId,
        title: input.title,
        description: input.description,
        category: input.category,
        location: input.location,
        onlineLink: input.onlineLink,
        eventDate: new Date(input.eventDate),
        totalCapacity: input.totalCapacity,
        availableTickets: input.totalCapacity, // Always initialized from totalCapacity
        ticketPrice: new Prisma.Decimal(input.ticketPrice),
        status: EventStatus.UPCOMING,
      },
      include: {
        organizer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // Invalidate list cache
    await cacheService.invalidateEventCache();

    logger.info(`🎉 Event created: "${event.title}" by organizer ${organizerId}`);
    return event;
  }

  /**
   * List events with Redis Read-Through Caching, filtering, and pagination (Public)
   */
  public async listEvents(query: ListEventsQuery) {
    const cacheKey = `events:list:${Buffer.from(JSON.stringify(query)).toString('base64')}`;
    const cached = await cacheService.get<{ events: any[]; pagination: any }>(cacheKey);

    if (cached) {
      return cached;
    }

    const { page, limit, category, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.EventWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = { equals: category, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { eventDate: 'asc' },
        include: {
          organizer: {
            select: { id: true, fullName: true, email: true },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    const result = {
      events,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    // Cache list query for 60 seconds
    await cacheService.set(cacheKey, result, CACHE_TTL.EVENT_LIST);

    return result;
  }

  /**
   * Get single event by ID with Redis Read-Through Caching (Public)
   */
  public async getEventById(id: string) {
    const cacheKey = `events:detail:${id}`;
    const cached = await cacheService.get<any>(cacheKey);

    if (cached) {
      return cached;
    }

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        organizer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!event) {
      throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found.');
    }

    // Cache event detail for 30 seconds
    await cacheService.set(cacheKey, event, CACHE_TTL.EVENT_DETAIL);

    return event;
  }

  /**
   * Update event details (Organizer ownership strictly enforced)
   * Triggers batched BullMQ broadcast notifications if critical fields change
   */
  public async updateEvent(eventId: string, organizerId: string, input: UpdateEventInput) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found.');
    }

    // Ownership check
    if (event.organizerId !== organizerId) {
      throw new AppError(403, ErrorCodes.NOT_OWNER, 'You can only update events you organized.');
    }

    if (event.status === EventStatus.CANCELLED) {
      throw new AppError(400, ErrorCodes.EVENT_CANCELLED, 'Cannot update a cancelled event.');
    }

    // Detect critical field changes for broadcast notifications
    const changedFields: string[] = [];
    if (input.title && input.title !== event.title) changedFields.push('title');
    if (input.eventDate && new Date(input.eventDate).getTime() !== event.eventDate.getTime())
      changedFields.push('eventDate');
    if (input.location && input.location !== event.location) changedFields.push('location');
    if (input.onlineLink !== undefined && input.onlineLink !== event.onlineLink)
      changedFields.push('onlineLink');

    const data: Prisma.EventUpdateInput = {};
    if (input.title) data.title = input.title;
    if (input.description) data.description = input.description;
    if (input.category) data.category = input.category;
    if (input.location) data.location = input.location;
    if (input.onlineLink !== undefined) data.onlineLink = input.onlineLink;
    if (input.eventDate) data.eventDate = new Date(input.eventDate);
    if (input.ticketPrice !== undefined) data.ticketPrice = new Prisma.Decimal(input.ticketPrice);

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data,
      include: {
        organizer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // Invalidate Redis caches
    await cacheService.invalidateEventCache(eventId);

    // If critical fields changed, fan out broadcast jobs to CONFIRMED attendees in batches
    if (changedFields.length > 0) {
      const confirmedBookings = await prisma.booking.findMany({
        where: {
          eventId,
          status: BookingStatus.CONFIRMED,
        },
        include: {
          customer: {
            select: { email: true, fullName: true },
          },
        },
      });

      if (confirmedBookings.length > 0) {
        const BATCH_SIZE = 50;
        const broadcastJobs = confirmedBookings.map((b) => ({
          eventId: updatedEvent.id,
          recipientEmail: b.customer.email,
          recipientName: b.customer.fullName,
          eventTitle: updatedEvent.title,
          eventDate: updatedEvent.eventDate.toISOString(),
          location: updatedEvent.location,
          changedFields,
        }));

        for (let i = 0; i < broadcastJobs.length; i += BATCH_SIZE) {
          const batch = broadcastJobs.slice(i, i + BATCH_SIZE);
          await enqueueEventUpdateBroadcastBatch(batch);
        }

        logger.info(
          `📢 Enqueued batched broadcast notifications to ${confirmedBookings.length} confirmed attendee(s)`
        );
      }
    }

    return updatedEvent;
  }

  /**
   * Soft-delete event by marking status = CANCELLED (Organizer ownership strictly enforced)
   */
  public async deleteEvent(eventId: string, organizerId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found.');
    }

    // Ownership check
    if (event.organizerId !== organizerId) {
      throw new AppError(403, ErrorCodes.NOT_OWNER, 'You can only cancel events you organized.');
    }

    if (event.status === EventStatus.CANCELLED) {
      return event; // Already cancelled
    }

    const cancelledEvent = await prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.CANCELLED },
    });

    // Invalidate Redis caches
    await cacheService.invalidateEventCache(eventId);

    logger.info(`🚫 Event soft-cancelled: "${cancelledEvent.title}" (${cancelledEvent.id})`);
    return cancelledEvent;
  }
}

export const eventService = new EventService();
