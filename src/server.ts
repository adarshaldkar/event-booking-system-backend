import app from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  // Connect to dependencies before accepting traffic
  await connectDatabase();
  await connectRedis();

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀  Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  // Start Outbox pattern background reconciliation sweep (runs every 60s)
  const { reconciliationService } = await import('./services/reconciliation.service');
  reconciliationService.startPeriodicSweep(60_000);

  // ── Graceful Shutdown ──────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received — shutting down gracefully...`);
    reconciliationService.stopPeriodicSweep();

    server.close(async () => {
      logger.info('HTTP server closed — active requests drained');
      try {
        const { notificationQueue } = await import('./jobs/notificationQueue');
        await notificationQueue.close();
      } catch (err) {
        logger.warn('Error closing notification queue during shutdown', { error: err });
      }
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('✅  Shutdown complete');
      process.exit(0);
    });

    // Force exit if shutdown takes more than 10s
    setTimeout(() => {
      logger.error('Forced shutdown — timeout exceeded');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { message: err.message, stack: err.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
