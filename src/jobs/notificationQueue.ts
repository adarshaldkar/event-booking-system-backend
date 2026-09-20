import { Queue, JobsOptions } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

export const NOTIFICATION_QUEUE_NAME = 'notification-queue';

export enum NotificationJobType {
  AUTH_OTP = 'AUTH_OTP',
  BOOKING_CONFIRMATION = 'BOOKING_CONFIRMATION',
  EVENT_UPDATE_BROADCAST = 'EVENT_UPDATE_BROADCAST',
}

export interface AuthOtpJobData {
  type: NotificationJobType.AUTH_OTP;
  email: string;
  fullName: string;
  otp: string;
  notificationLogId?: string;
}

export interface BookingConfirmationJobData {
  type: NotificationJobType.BOOKING_CONFIRMATION;
  bookingId: string;
  notificationLogId?: string;
}

export interface EventUpdateBroadcastJobData {
  type: NotificationJobType.EVENT_UPDATE_BROADCAST;
  eventId: string;
  recipientEmail: string;
  recipientName: string;
  eventTitle: string;
  eventDate: string;
  location: string;
  changedFields: string[];
  notificationLogId?: string;
}

export type NotificationJobPayload =
  | AuthOtpJobData
  | BookingConfirmationJobData
  | EventUpdateBroadcastJobData;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 1000,
  },
  removeOnFail: {
    age: 86400 * 3, // 3 days
    count: 5000,
  },
};

// BullMQ Queue instance
export const notificationQueue = new Queue<NotificationJobPayload>(NOTIFICATION_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/**
 * Enqueue an OTP email job (non-blocking)
 */
export async function enqueueOtpEmail(data: {
  email: string;
  fullName: string;
  otp: string;
  notificationLogId?: string;
}) {
  try {
    const job = await notificationQueue.add(
      NotificationJobType.AUTH_OTP,
      {
        type: NotificationJobType.AUTH_OTP,
        email: data.email,
        fullName: data.fullName,
        otp: data.otp,
        notificationLogId: data.notificationLogId,
      },
      DEFAULT_JOB_OPTIONS
    );
    logger.info(`📥 Enqueued AUTH_OTP job #${job.id} for ${data.email}`);
    return job;
  } catch (err: any) {
    logger.error(`Failed to enqueue AUTH_OTP job for ${data.email}`, { error: err.message });
  }
}

/**
 * Enqueue a booking confirmation job with QR e-ticket generation (non-blocking)
 */
export async function enqueueBookingConfirmation(bookingId: string, notificationLogId?: string) {
  try {
    const job = await notificationQueue.add(
      NotificationJobType.BOOKING_CONFIRMATION,
      {
        type: NotificationJobType.BOOKING_CONFIRMATION,
        bookingId,
        notificationLogId,
      },
      DEFAULT_JOB_OPTIONS
    );
    logger.info(`📥 Enqueued BOOKING_CONFIRMATION job #${job.id} for booking ${bookingId}`);
    return job;
  } catch (err: any) {
    logger.error(`Failed to enqueue BOOKING_CONFIRMATION job for booking ${bookingId}`, {
      error: err.message,
    });
  }
}

/**
 * Enqueue a batch of event update broadcast jobs (non-blocking)
 */
export async function enqueueEventUpdateBroadcastBatch(
  jobs: Array<{
    eventId: string;
    recipientEmail: string;
    recipientName: string;
    eventTitle: string;
    eventDate: string;
    location: string;
    changedFields: string[];
    notificationLogId?: string;
  }>
) {
  try {
    const bulkJobs = jobs.map((data) => ({
      name: NotificationJobType.EVENT_UPDATE_BROADCAST,
      data: {
        type: NotificationJobType.EVENT_UPDATE_BROADCAST as const,
        ...data,
      },
      opts: DEFAULT_JOB_OPTIONS,
    }));

    await notificationQueue.addBulk(bulkJobs);
    logger.info(`📥 Enqueued batch of ${jobs.length} EVENT_UPDATE_BROADCAST jobs`);
  } catch (err: any) {
    logger.error(`Failed to enqueue EVENT_UPDATE_BROADCAST batch`, { error: err.message });
  }
}
