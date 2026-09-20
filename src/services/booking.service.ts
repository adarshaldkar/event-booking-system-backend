import { prisma } from '../config/database';
import { Prisma, BookingStatus } from '@prisma/client';
import { AppError, ErrorCodes } from '../middleware/error.middleware';
import { CreateBookingInput } from '../validators/booking.validator';
import { enqueueBookingConfirmation } from '../jobs/notificationQueue';
import { cacheService } from '../utils/cache';
import { logger } from '../utils/logger';

export class BookingService {
  /**
   * Create a booking atomically with zero overselling guarantee and concurrency-safe idempotency.
   */
  public async createBooking(
    customerId: string,
    input: CreateBookingInput,
    idempotencyKey?: string
  ) {
    // 1. Fast Path: Check if an idempotent request was already processed
    if (idempotencyKey) {
      const existingBooking = await prisma.booking.findUnique({
        where: { idempotencyKey },
        include: {
          event: {
            select: { id: true, title: true, eventDate: true, location: true, ticketPrice: true },
          },
        },
      });

      if (existingBooking) {
        logger.info(`🔁 Idempotent booking replayed: ${existingBooking.bookingReference}`);
        return { booking: existingBooking, isReplayed: true };
      }
    }

    try {
      // 2. Interactive transaction: Atomic Conditional Inventory Decrement + Booking Insertion
      const booking = await prisma.$transaction(async (tx) => {
        // Atomic conditional decrement in PostgreSQL
        const updatedEvents = await tx.$queryRaw<
          Array<{
            id: string;
            ticketPrice: Prisma.Decimal;
            availableTickets: number;
            status: string;
            eventDate: Date;
          }>
        >`
          UPDATE "events"
          SET "availableTickets" = "availableTickets" - ${input.quantity},
              "updatedAt" = NOW()
          WHERE "id" = ${input.eventId}
            AND "availableTickets" >= ${input.quantity}
            AND "status" = 'UPCOMING'
          RETURNING "id", "ticketPrice", "availableTickets", "status", "eventDate";
        `;

        if (!updatedEvents || updatedEvents.length === 0) {
          // Check reason for failure to provide accurate error code
          const event = await tx.event.findUnique({
            where: { id: input.eventId },
            select: { availableTickets: true, status: true, eventDate: true },
          });

          if (!event) {
            throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found.');
          }

          if (event.status !== 'UPCOMING') {
            throw new AppError(400, ErrorCodes.EVENT_CANCELLED, 'Cannot book tickets for this event.');
          }

          if (new Date(event.eventDate) <= new Date()) {
            throw new AppError(400, ErrorCodes.PAST_EVENT, 'This event has already taken place.');
          }

          if (event.availableTickets === 0) {
            throw new AppError(409, ErrorCodes.SOLD_OUT, 'This event is completely sold out.');
          }

          throw new AppError(
            409,
            ErrorCodes.INSUFFICIENT_TICKETS,
            `Not enough tickets available. Only ${event.availableTickets} ticket(s) remaining.`
          );
        }

        const event = updatedEvents[0];
        const totalAmount = new Prisma.Decimal(event.ticketPrice).mul(input.quantity);

        // Insert booking record
        const createdBooking = await tx.booking.create({
          data: {
            customerId,
            eventId: input.eventId,
            ticketCount: input.quantity,
            totalAmount,
            idempotencyKey: idempotencyKey || null,
            status: BookingStatus.CONFIRMED,
          },
          include: {
            event: {
              select: { id: true, title: true, eventDate: true, location: true, ticketPrice: true },
            },
          },
        });

        return createdBooking;
      });

      // Invalidate event detail cache (available tickets changed)
      await cacheService.invalidateEventCache(input.eventId);

      // Enqueue asynchronous booking confirmation job with signed QR code
      enqueueBookingConfirmation(booking.id).catch((err) => {
        logger.error(`Failed to enqueue booking confirmation job for booking ${booking.id}`, {
          error: err.message,
        });
      });

      logger.info(`🎟️ Booking created: ${booking.bookingReference} for ${input.quantity} ticket(s)`);
      return { booking, isReplayed: false };
    } catch (err: any) {
      // 3. Handle concurrent parallel race on exact same Idempotency-Key
      if (idempotencyKey && (err.code === 'P2002' || err.message?.includes('Unique constraint failed'))) {
        logger.info(`🔁 Resolving concurrent duplicate Idempotency-Key race for key: ${idempotencyKey}`);
        const existingBooking = await prisma.booking.findUnique({
          where: { idempotencyKey },
          include: {
            event: {
              select: { id: true, title: true, eventDate: true, location: true, ticketPrice: true },
            },
          },
        });

        if (existingBooking) {
          return { booking: existingBooking, isReplayed: true };
        }
      }

      throw err;
    }
  }

  /**
   * Get all bookings for authenticated customer
   */
  public async getCustomerBookings(customerId: string) {
    return prisma.booking.findMany({
      where: { customerId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            category: true,
            location: true,
            eventDate: true,
            ticketPrice: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get single booking by ID with customer ownership check
   */
  public async getBookingById(bookingId: string, customerId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            location: true,
            onlineLink: true,
            eventDate: true,
            ticketPrice: true,
            status: true,
          },
        },
        customer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!booking) {
      throw new AppError(404, ErrorCodes.BOOKING_NOT_FOUND, 'Booking not found.');
    }

    if (booking.customerId !== customerId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Access denied. You can only view your own bookings.');
    }

    return booking;
  }

  /**
   * Cancel booking atomically and restock inventory in a single transaction.
   */
  public async cancelBooking(bookingId: string, customerId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch booking to verify existence, ownership, and event date
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          event: {
            select: { id: true, eventDate: true },
          },
        },
      });

      if (!existing) {
        throw new AppError(404, ErrorCodes.BOOKING_NOT_FOUND, 'Booking not found.');
      }

      if (existing.customerId !== customerId) {
        throw new AppError(403, ErrorCodes.FORBIDDEN, 'Access denied. You can only cancel your own bookings.');
      }

      if (existing.status === BookingStatus.CANCELLED) {
        throw new AppError(400, ErrorCodes.ALREADY_CANCELLED, 'This booking has already been cancelled.');
      }

      if (new Date(existing.event.eventDate) <= new Date()) {
        throw new AppError(400, ErrorCodes.PAST_EVENT, 'Cannot cancel a booking for an event that has already occurred or started.');
      }

      // 2. Atomic status transition: CONFIRMED -> CANCELLED
      const updatedBookings = await tx.$queryRaw<
        Array<{
          id: string;
          eventId: string;
          ticketCount: number;
          status: string;
        }>
      >`
        UPDATE "bookings"
        SET "status" = 'CANCELLED',
            "updatedAt" = NOW()
        WHERE "id" = ${bookingId}
          AND "customerId" = ${customerId}
          AND "status" = 'CONFIRMED'
        RETURNING "id", "eventId", "ticketCount", "status";
      `;

      if (!updatedBookings || updatedBookings.length === 0) {
        throw new AppError(400, ErrorCodes.ALREADY_CANCELLED, 'This booking has already been cancelled.');
      }

      const cancelledBooking = updatedBookings[0];

      // 3. Atomically restock availableTickets in event
      await tx.$queryRaw`
        UPDATE "events"
        SET "availableTickets" = "availableTickets" + ${cancelledBooking.ticketCount},
            "updatedAt" = NOW()
        WHERE "id" = ${cancelledBooking.eventId};
      `;

      // Invalidate event detail cache
      await cacheService.invalidateEventCache(cancelledBooking.eventId);

      logger.info(`🔄 Booking cancelled & restocked: ${bookingId} (+${cancelledBooking.ticketCount} tickets)`);

      return {
        id: cancelledBooking.id,
        status: BookingStatus.CANCELLED,
        restockedTickets: cancelledBooking.ticketCount,
        message: 'Booking successfully cancelled and tickets restocked to event inventory.',
      };
    });
  }
}

export const bookingService = new BookingService();
