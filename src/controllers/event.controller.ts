import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services/event.service';
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from '../validators/event.validator';

export class EventController {
  /**
   * POST /api/events (Organizer Only)
   */
  public async createEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = createEventSchema.parse(req.body);
      const event = await eventService.createEvent(req.user!.id, validated);
      res.status(201).json({
        success: true,
        data: event,
        message: 'Event created successfully.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/events (Public)
   */
  public async listEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listEventsQuerySchema.parse(req.query);
      const result = await eventService.listEvents(query);
      res.status(200).json({
        success: true,
        data: result.events,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/events/:id (Public)
   */
  public async getEventById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await eventService.getEventById(req.params.id);
      res.status(200).json({
        success: true,
        data: event,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/events/:id (Organizer & Owner Only)
   */
  public async updateEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = updateEventSchema.parse(req.body);
      const event = await eventService.updateEvent(req.params.id, req.user!.id, validated);
      res.status(200).json({
        success: true,
        data: event,
        message: 'Event updated successfully.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/events/:id (Organizer & Owner Only - Soft Cancel)
   */
  public async deleteEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await eventService.deleteEvent(req.params.id, req.user!.id);
      res.status(200).json({
        success: true,
        data: event,
        message: 'Event cancelled successfully.',
      });
    } catch (err) {
      next(err);
    }
  }
}

export const eventController = new EventController();
