import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { emailService } from '../services/email.service';
import { qrService } from '../services/qr.service';
import {
  NOTIFICATION_QUEUE_NAME,
  NotificationJobType,
  NotificationJobPayload,
} from '../jobs/notificationQueue';
import { logger } from '../utils/logger';

/**
 * BullMQ Email & Notification Worker
 * Concurrency: 5 simultaneous job threads
 */
export const emailWorker = new Worker<NotificationJobPayload>(
  NOTIFICATION_QUEUE_NAME,
  async (job: Job<NotificationJobPayload>) => {
    const currentAttempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 3;

    logger.info(
      `⚙️ Processing job #${job.id} [${job.name}] (Attempt ${currentAttempt}/${maxAttempts})`
    );

    switch (job.data.type) {
      case NotificationJobType.AUTH_OTP: {
        await emailService.sendOtpEmail({
          to: job.data.email,
          fullName: job.data.fullName,
          otp: job.data.otp,
          notificationLogId: job.data.notificationLogId,
          currentAttempt,
          maxAttempts,
        });
        break;
      }

      case NotificationJobType.BOOKING_CONFIRMATION: {
        const booking = await prisma.booking.findUnique({
          where: { id: job.data.bookingId },
          include: {
            event: true,
            customer: true,
          },
        });

        if (!booking) {
          logger.warn(`Booking #${job.data.bookingId} not found during worker execution`);
          return;
        }

        // Generate signed QR code e-ticket
        const qrDataUrl = await qrService.generateQrCodeDataUrl({
          ref: booking.bookingReference,
          eventId: booking.eventId,
          tickets: booking.ticketCount,
          holder: booking.customer.fullName,
        });

        await emailService.sendBookingConfirmationEmail({
          to: booking.customer.email,
          fullName: booking.customer.fullName,
          bookingReference: booking.bookingReference,
          eventTitle: booking.event.title,
          eventDate: booking.event.eventDate,
          location: booking.event.location,
          ticketCount: booking.ticketCount,
          totalAmount: booking.totalAmount.toNumber(),
          qrDataUrl,
          bookingId: booking.id,
          eventId: booking.eventId,
          notificationLogId: job.data.notificationLogId,
          currentAttempt,
          maxAttempts,
        });
        break;
      }

      case NotificationJobType.EVENT_UPDATE_BROADCAST: {
        await emailService.sendEventUpdateBroadcastEmail({
          to: job.data.recipientEmail,
          fullName: job.data.recipientName,
          eventTitle: job.data.eventTitle,
          eventDate: job.data.eventDate,
          location: job.data.location,
          onlineLink: job.data.onlineLink,
          changedFields: job.data.changedFields,
          eventId: job.data.eventId,
          notificationLogId: job.data.notificationLogId,
          currentAttempt,
          maxAttempts,
        });
        break;
      }

      default:
        logger.warn(`Unknown job type received: ${(job.data as any)?.type}`);
    }

    logger.info(`✅ Successfully finished job #${job.id} [${job.name}]`);
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

emailWorker.on('completed', (job) => {
  logger.info(`🎉 Worker job #${job.id} marked COMPLETED`);
});

emailWorker.on('failed', (job, err) => {
  const attempts = job ? job.attemptsMade : 0;
  const max = job?.opts.attempts || 3;
  logger.error(`❌ Worker job #${job?.id} failed on attempt ${attempts}/${max}: ${err.message}`);
});

// Heartbeat key for deep worker liveness tracking in /health
export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat:email';
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TTL_SECONDS = 15;

// Run standalone when executed directly
if (require.main === module) {
  logger.info('🚀 Starting standalone BullMQ Email Worker (concurrency: 5)...');

  const emitHeartbeat = async () => {
    try {
      await redis.set(WORKER_HEARTBEAT_KEY, Date.now().toString(), 'EX', HEARTBEAT_TTL_SECONDS);
    } catch (err: any) {
      logger.warn('Failed to publish worker heartbeat to Redis', { error: err.message });
    }
  };

  // Initial heartbeat and periodic timer
  emitHeartbeat();
  const heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — closing email worker gracefully...`);
    clearInterval(heartbeatTimer);
    await redis.del(WORKER_HEARTBEAT_KEY).catch(() => {});
    await emailWorker.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
