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
        await emailService.deliverWithLogging({
          to: job.data.email,
          subject: 'Your Verification Code - Event Booking System',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
              <h2 style="color: #4F46E5;">Welcome to Event Booking System</h2>
              <p>Hello <strong>${job.data.fullName}</strong>,</p>
              <p>Your verification code is:</p>
              <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${job.data.otp}</span>
              </div>
              <p style="color: #6B7280; font-size: 14px;">Valid for 10 minutes.</p>
            </div>
          `,
          type: 'AUTH_OTP' as any,
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
          changedFields: job.data.changedFields,
          eventId: job.data.eventId,
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

// Run standalone when executed directly
if (require.main === module) {
  logger.info('🚀 Starting standalone BullMQ Email Worker (concurrency: 5)...');

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — closing email worker gracefully...`);
    await emailWorker.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
