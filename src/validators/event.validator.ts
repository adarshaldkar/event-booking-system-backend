import { z } from 'zod';
import { EventStatus } from '@prisma/client';

export const createEventSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(3, 'Title must be at least 3 characters long')
    .max(150, 'Title must not exceed 150 characters'),
  description: z
    .string({ required_error: 'Description is required' })
    .trim()
    .min(10, 'Description must be at least 10 characters long')
    .max(5000, 'Description must not exceed 5000 characters'),
  category: z
    .string({ required_error: 'Category is required' })
    .trim()
    .min(2, 'Category must be at least 2 characters long'),
  location: z
    .string({ required_error: 'Location is required' })
    .trim()
    .min(2, 'Location must be at least 2 characters long'),
  onlineLink: z.string().url('Online link must be a valid URL').optional().nullable(),
  eventDate: z
    .string({ required_error: 'Event date is required' })
    .datetime('Event date must be a valid ISO datetime string (e.g. 2026-11-15T09:00:00.000Z)')
    .refine((date) => new Date(date) > new Date(), {
      message: 'Event date must be scheduled in the future.',
    }),
  totalCapacity: z
    .number({ required_error: 'Total capacity is required' })
    .int('Total capacity must be an integer')
    .positive('Total capacity must be greater than 0'),
  ticketPrice: z
    .number({ required_error: 'Ticket price is required' })
    .nonnegative('Ticket price must be greater than or equal to 0.00'),
});

export const updateEventSchema = z.object({
  title: z.string().trim().min(3).max(150).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  category: z.string().trim().min(2).optional(),
  location: z.string().trim().min(2).optional(),
  onlineLink: z.string().url().optional().nullable(),
  eventDate: z
    .string()
    .datetime()
    .refine((date) => new Date(date) > new Date(), {
      message: 'Event date must be scheduled in the future.',
    })
    .optional(),
  ticketPrice: z.number().nonnegative().optional(),
});

export const listEventsQuerySchema = z.object({
  page: z.string().optional().transform((v) => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  limit: z.string().optional().transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10))) : 10)),
  category: z.string().optional(),
  status: z.nativeEnum(EventStatus).optional().default(EventStatus.UPCOMING),
  search: z.string().optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
