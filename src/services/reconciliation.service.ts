import { prisma } from '../config/database';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { enqueueBookingConfirmation } from '../jobs/notificationQueue';
import { logger } from '../utils/logger';

export class ReconciliationService {
  private sweepInterval: NodeJS.Timeout | null = null;

  /**
   * Outbox Pattern Reconciliation Sweep:
   * Finds any pending notifications that failed to enqueue or got stuck, and safely re-enqueues them.
   */
  public async reconcilePendingNotifications(olderThanSeconds: number = 60): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanSeconds * 1000);

    const pendingLogs = await prisma.notificationLog.findMany({
      where: {
        deliveryStatus: NotificationStatus.PENDING,
        attempts: { lt: 3 },
        createdAt: { lt: cutoffDate },
      },
      include: {
        booking: {
          include: {
            event: true,
            customer: true,
          },
        },
      },
      take: 50,
    });

    if (pendingLogs.length === 0) {
      return 0;
    }

    logger.info(`🔄 [Outbox Reconciliation] Found ${pendingLogs.length} pending notification(s) to reconcile`);

    let reconciledCount = 0;

    for (const log of pendingLogs) {
      try {
        if (log.notificationType === NotificationType.BOOKING_CONFIRMATION && log.bookingId) {
          logger.info(`🔄 [Outbox Reconciliation] Re-enqueuing booking confirmation #${log.bookingId}`);
          await enqueueBookingConfirmation(log.bookingId, log.id);
          reconciledCount++;
        }
      } catch (err: any) {
        logger.error(`❌ [Outbox Reconciliation] Failed to reconcile log #${log.id}`, {
          error: err.message,
        });
      }
    }

    return reconciledCount;
  }

  /**
   * Start recurring background reconciliation sweep
   */
  public startPeriodicSweep(intervalMs: number = 60_000): void {
    if (this.sweepInterval) {
      return;
    }

    logger.info(`⏰ Starting periodic Outbox Reconciliation sweep (interval: ${intervalMs}ms)`);
    this.sweepInterval = setInterval(() => {
      this.reconcilePendingNotifications().catch((err) => {
        logger.error('Error during scheduled outbox reconciliation sweep', { error: err.message });
      });
    }, intervalMs);
  }

  /**
   * Stop background reconciliation sweep
   */
  public stopPeriodicSweep(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
      logger.info('🛑 Stopped periodic Outbox Reconciliation sweep');
    }
  }
}

export const reconciliationService = new ReconciliationService();
