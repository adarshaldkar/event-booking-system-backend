import { describe, it, expect, afterAll } from 'vitest';
import {
  notificationQueue,
  enqueueOtpEmail,
  enqueueBookingConfirmation,
  NotificationJobType,
} from '../src/jobs/notificationQueue';
import { emailService } from '../src/services/email.service';
import { prisma } from '../src/config/database';
import { NotificationStatus, NotificationType } from '@prisma/client';

describe('Phase 4: BullMQ Worker Queue & Notification Lifecycle', () => {
  afterAll(async () => {
    await prisma.notificationLog.deleteMany({
      where: { recipientEmail: { contains: 'queue_test' } },
    });
    await notificationQueue.close();
    await prisma.$disconnect();
  });

  it('TC-QUEUE-01: Producer enqueues AUTH_OTP job into BullMQ', async () => {
    const job = await enqueueOtpEmail({
      email: 'queue_test_otp@example.com',
      fullName: 'Queue Test User',
      otp: '789012',
    });

    expect(job).toBeDefined();
    expect(job?.name).toBe(NotificationJobType.AUTH_OTP);
    expect(job?.data.type).toBe(NotificationJobType.AUTH_OTP);
    expect(job?.data.otp).toBe('789012');
  });

  it('TC-QUEUE-02: Producer enqueues BOOKING_CONFIRMATION job into BullMQ', async () => {
    const job = await enqueueBookingConfirmation('sample-booking-id-123');

    expect(job).toBeDefined();
    expect(job?.name).toBe(NotificationJobType.BOOKING_CONFIRMATION);
    expect(job?.data.bookingId).toBe('sample-booking-id-123');
  });

  it('TC-QUEUE-04: Failed delivery keeps status PENDING during initial retry attempts (< 3)', async () => {
    const testEmail = `queue_test_retry_${Date.now()}@example.com`;

    // Simulate an initial delivery failure on attempt 1 of 3
    try {
      await emailService.deliverWithLogging({
        to: testEmail,
        subject: 'Retry Test',
        html: '<p>Testing retries</p>',
        type: NotificationType.AUTH_OTP,
        currentAttempt: 1,
        maxAttempts: 3,
      });
    } catch {
      // expected failure in test
    }

    const log = await prisma.notificationLog.findFirst({
      where: { recipientEmail: testEmail },
      orderBy: { createdAt: 'desc' },
    });

    expect(log).not.toBeNull();
    expect(log?.attempts).toBe(1);
    // Status MUST remain PENDING because retries are still remaining
    expect(log?.deliveryStatus).toBe(NotificationStatus.PENDING);
  });

  it('TC-QUEUE-05: NotificationLog is marked FAILED only after final retry is exhausted (attempt 3 of 3)', async () => {
    const testEmail = `queue_test_final_fail_${Date.now()}@example.com`;

    // Simulate the final failure on attempt 3 of 3
    try {
      await emailService.deliverWithLogging({
        to: testEmail,
        subject: 'Final Failure Test',
        html: '<p>Testing final failure</p>',
        type: NotificationType.AUTH_OTP,
        currentAttempt: 3,
        maxAttempts: 3,
      });
    } catch {
      // expected failure in test
    }

    const log = await prisma.notificationLog.findFirst({
      where: { recipientEmail: testEmail },
      orderBy: { createdAt: 'desc' },
    });

    expect(log).not.toBeNull();
    expect(log?.attempts).toBe(3);
    // Status MUST be FAILED after exhausting max attempts
    expect(log?.deliveryStatus).toBe(NotificationStatus.FAILED);
  });

  it('TC-QUEUE-06: Successful email delivery creates NotificationLog with status SENT and providerMessageId', async () => {
    const testEmail = 'delivered@resend.dev';

    const result = await emailService.deliverWithLogging({
      to: testEmail,
      subject: 'Success Delivery Test',
      html: '<p>Delivery confirmed</p>',
      type: NotificationType.AUTH_OTP,
      currentAttempt: 1,
      maxAttempts: 3,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();

    const log = await prisma.notificationLog.findFirst({
      where: { recipientEmail: testEmail },
      orderBy: { createdAt: 'desc' },
    });

    expect(log).not.toBeNull();
    expect(log?.deliveryStatus).toBe(NotificationStatus.SENT);
    expect(log?.providerMessageId).toBe(result.messageId);
    expect(log?.sentAt).not.toBeNull();
  });
});
