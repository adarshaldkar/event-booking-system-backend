import { Request, Response, NextFunction } from 'express';
import { bookingService } from '../services/booking.service';
import { createBookingSchema } from '../validators/booking.validator';

export class BookingController {
  /**
   * POST /api/bookings (Customer Only, supports Idempotency-Key)
   */
  public async createBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.trim();
      const validated = createBookingSchema.parse(req.body);
      const result = await bookingService.createBooking(req.user!.id, validated, idempotencyKey);

      res.status(result.isReplayed ? 200 : 201).json({
        success: true,
        data: result.booking,
        isReplayed: result.isReplayed,
        message: result.isReplayed
          ? 'Existing booking returned (Idempotency Replay).'
          : 'Tickets booked successfully.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/bookings (Customer Only - List own bookings)
   */
  public async getCustomerBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const bookings = await bookingService.getCustomerBookings(req.user!.id);
      res.status(200).json({
        success: true,
        data: bookings,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/bookings/:id (Customer Only - Single booking details)
   */
  public async getBookingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const booking = await bookingService.getBookingById(req.params.id, req.user!.id);
      res.status(200).json({
        success: true,
        data: booking,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/bookings/:id/cancel (Customer Only - Cancel & Restock)
   */
  public async cancelBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await bookingService.cancelBooking(req.params.id, req.user!.id);
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const bookingController = new BookingController();
