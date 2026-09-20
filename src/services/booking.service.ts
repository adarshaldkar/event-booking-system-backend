import { prisma } from '../config/database';
import { Prisma, BookingStatus, NotificationType, NotificationStatus } from '@prisma/client';
import { AppError, ErrorCodes } from '../middleware/error.middleware';
import { CreateBookingInput } from '../validators/booking.validator';
import { enqueueBookingConfirmation } from '../jobs/notificationQueue';
import { cacheService } from '../utils/cache';
import { logger } from '../utils/logger';

export class BookingService {
  /**
   * Create a booking atomically with zero overselling guarantee, customer-scoped idempotency,
   * payload mismatch protection, and past-event prevention at the SQL layer.
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
        // Security Check 1: Idempotency-Key is strictly scoped to the owning customer
        if (existingBooking.customerId !== customerId) {
          throw new AppError(
            403,
            ErrorCodes.FORBIDDEN,
            'Idempotency key belongs to another customer.'
          );
        }

        // Security Check 2: Payload mismatch detection (same key, different event or quantity)
        if (
          existingBooking.eventId !== input.eventId ||
          existingBooking.ticketCount !== input.quantity
        ) {
          throw new AppError(
            409,
            ErrorCodes.DUPLICATE_BOOKING,
            'Idempotency key was previously used with a different request payload.'
          );
        }

        logger.info(`🔁 Idempotent booking replayed: ${existingBooking.bookingReference}`);
        return { booking: existingBooking, isReplayed: true };
      }
    }

    try {
      // 2. Interactive transaction: Atomic Conditional Inventory Decrement + Booking & Outbox Log Insertion
      const { booking, notificationLogId } = await prisma.$transaction(async (tx) => {
        // Atomic conditional decrement in PostgreSQL (strictly enforcing status=UPCOMING AND eventDate > NOW())
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
            AND "eventDate" > NOW()
          RETURNING "id", "ticketPrice", "availableTickets", "status", "eventDate";
        `;

        if (!updatedEvents || updatedEvents.length === 0) {
          // Diagnose the failure reason to return the precise HTTP error code
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

        // Fetch customer email for outbox log
        const customer = await tx.user.findUnique({
          where: { id: customerId },
          select: { email: true },
        });

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

        // Outbox Pattern: Persist single NotificationLog in PENDING state inside the same ACID transaction
        const outboxLog = await tx.notificationLog.create({
          data: {
            recipientEmail: customer?.email || '',
            notificationType: NotificationType.BOOKING_CONFIRMATION,
            deliveryStatus: NotificationStatus.PENDING,
            eventId: input.eventId,
            bookingId: createdBooking.id,
            attempts: 0,
          },
        });

        return { booking: createdBooking, notificationLogId: outboxLog.id };
      });

      // Invalidate event detail cache (available tickets changed)
      await cacheService.invalidateEventCache(input.eventId);

      // Enqueue asynchronous booking confirmation job with outbox tracking
      enqueueBookingConfirmation(booking.id, notificationLogId).catch((err) => {
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
          if (existingBooking.customerId !== customerId) {
            throw new AppError(
              403,
              ErrorCodes.FORBIDDEN,
              'Idempotency key belongs to another customer.'
            );
          }

          if (
            existingBooking.eventId !== input.eventId ||
            existingBooking.ticketCount !== input.quantity
          ) {
            throw new AppError(
              409,
              ErrorCodes.DUPLICATE_BOOKING,
              'Idempotency key was previously used with a different request payload.'
            );
          }

          return { booking: existingBooking, isReplayed: true };
        }
      }

      throw err;
    }
  }

  /**
   * List customer's own booking history
   */
  public async getCustomerBookings(customerId: string) {
    return prisma.booking.findMany({
      where: { customerId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            eventDate: true,
            location: true,
            ticketPrice: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get specific booking by ID (Customer ownership enforced)
   */
  public async getBookingById(bookingId: string, customerId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        event: true,
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
   * Cancel booking and atomically restore ticket inventory.
   */
  public async cancelBooking(bookingId: string, customerId: string) {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch booking with row lock/isolation
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { event: true },
      });

      if (!booking) {
        throw new AppError(404, ErrorCodes.BOOKING_NOT_FOUND, 'Booking not found.');
      }

      if (booking.customerId !== customerId) {
        throw new AppError(403, ErrorCodes.FORBIDDEN, 'Access denied. You can only cancel your own bookings.');
      }

      if (booking.status === BookingStatus.CANCELLED) {
        throw new AppError(400, ErrorCodes.ALREADY_CANCELLED, 'This booking has already been cancelled.');
      }

      // Check if event already took place
      if (new Date(booking.event.eventDate) <= new Date()) {
        throw new AppError(
          400,
          ErrorCodes.PAST_EVENT,
          'Cannot cancel a booking for an event that has already occurred or started.'
        );
      }

      // 2. Atomically update booking status from CONFIRMED to CANCELLED
      const updatedBooking = await tx.booking.updateMany({
        where: {
          id: bookingId,
          status: BookingStatus.CONFIRMED, // Concurrency protection against simultaneous cancels
        },
        data: {
          status: BookingStatus.CANCELLED,
        },
      });

      if (updatedBooking.count === 0) {
        throw new AppError(400, ErrorCodes.ALREADY_CANCELLED, 'This booking has already been cancelled.');
      }

      // 3. Atomically restore event inventory
      await tx.event.update({
        where: { id: booking.eventId },
        data: {
          availableTickets: {
            increment: booking.ticketCount,
          },
        },
      });

      return {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        eventId: booking.eventId,
        status: BookingStatus.CANCELLED,
        restockedTickets: booking.ticketCount,
      };
    });

    // Invalidate Redis cache
    await cacheService.invalidateEventCache(result.eventId);

    logger.info(`🚫 Booking cancelled & restocked: ${result.bookingReference} (+${result.restockedTickets} tickets)`);
    return {
      bookingId: result.bookingId,
      bookingReference: result.bookingReference,
      eventId: result.eventId,
      status: result.status,
      restockedTickets: result.restockedTickets,
      message: `Booking #${result.bookingReference} cancelled successfully. ${result.restockedTickets} ticket(s) restored to available inventory.`,
    };
  }
}

export const bookingService = new BookingService();
