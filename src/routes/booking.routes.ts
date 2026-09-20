import { Router } from 'express';
import { bookingController } from '../controllers/booking.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { Role } from '@prisma/client';

const router = Router();

// All booking routes require authentication and CUSTOMER role
router.use(authenticate);
router.use(requireRole(Role.CUSTOMER));

// POST /api/bookings (Atomic booking with Idempotency-Key support)
router.post('/', (req, res, next) => bookingController.createBooking(req, res, next));

// GET /api/bookings (List customer's bookings)
router.get('/', (req, res, next) => bookingController.getCustomerBookings(req, res, next));

// GET /api/bookings/:id (Single booking details)
router.get('/:id', (req, res, next) => bookingController.getBookingById(req, res, next));

// POST /api/bookings/:id/cancel (Cancel & restock inventory)
router.post('/:id/cancel', (req, res, next) => bookingController.cancelBooking(req, res, next));

export default router;
