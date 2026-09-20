import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError, ErrorCodes } from './error.middleware';

// Verifies that the requesting organizer owns the event they are trying to modify.
// Must be mounted AFTER authenticateToken and requireRole('ORGANIZER').
export async function requireEventOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const eventId = req.params.id;
    const organizerId = req.user!.id;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { organizerId: true },
    });

    if (!event) {
      return next(new AppError('Event not found.', 404, ErrorCodes.EVENT_NOT_FOUND));
    }

    if (event.organizerId !== organizerId) {
      return next(
        new AppError(
          'You do not have permission to modify this event.',
          403,
          ErrorCodes.NOT_OWNER
        )
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

// Verifies the booking belongs to the requesting customer.
// Must be mounted AFTER authenticateToken.
export async function requireBookingOwnership(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const bookingId = req.params.id;
    const customerId = req.user!.id;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true },
    });

    if (!booking) {
      return next(new AppError('Booking not found.', 404, ErrorCodes.BOOKING_NOT_FOUND));
    }

    if (booking.customerId !== customerId) {
      return next(
        new AppError(
          'You do not have permission to access this booking.',
          403,
          ErrorCodes.NOT_OWNER
        )
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}
