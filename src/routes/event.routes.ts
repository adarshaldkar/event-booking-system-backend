import { Router } from 'express';
import { eventController } from '../controllers/event.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { Role } from '@prisma/client';

const router = Router();

// Public event discovery endpoints
router.get('/', (req, res, next) => eventController.listEvents(req, res, next));
router.get('/:id', (req, res, next) => eventController.getEventById(req, res, next));

// Protected Organizer management endpoints
router.post(
  '/',
  authenticate,
  requireRole(Role.ORGANIZER),
  (req, res, next) => eventController.createEvent(req, res, next)
);

router.put(
  '/:id',
  authenticate,
  requireRole(Role.ORGANIZER),
  (req, res, next) => eventController.updateEvent(req, res, next)
);

router.delete(
  '/:id',
  authenticate,
  requireRole(Role.ORGANIZER),
  (req, res, next) => eventController.deleteEvent(req, res, next)
);

export default router;
