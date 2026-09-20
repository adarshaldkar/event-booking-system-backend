import { z } from 'zod';

export const createBookingSchema = z.object({
  eventId: z
    .string({ required_error: 'Event ID is required' })
    .uuid('Invalid event ID format'),
  quantity: z
    .number({ required_error: 'Quantity is required' })
    .int('Quantity must be an integer')
    .min(1, 'You must book at least 1 ticket')
    .max(10, 'Maximum 10 tickets per booking transaction'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
