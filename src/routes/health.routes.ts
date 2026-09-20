import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { redis, checkRedisHealth } from '../config/redis';
import { notificationQueue } from '../jobs/notificationQueue';

const router = Router();

/**
 * GET /health
 * Deep health probe reporting status of PostgreSQL, Redis, BullMQ queue connectivity, and worker process heartbeat.
 * - Database DOWN -> 503 Service Unavailable
 * - Redis DOWN    -> 503 Service Unavailable
 * - Worker Queue  -> If queue is degraded/unavailable, API remains 200 OK with 'degraded' status.
 */
router.get('/', async (_req: Request, res: Response) => {
  const startDb = performance.now();
  const dbHealthy = await prisma.$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);
  const dbResponseTimeMs = Math.round((performance.now() - startDb) * 100) / 100;

  const startRedis = performance.now();
  const redisHealthy = await checkRedisHealth();
  const redisResponseTimeMs = Math.round((performance.now() - startRedis) * 100) / 100;

  let queueHealthy = false;
  try {
    const isPaused = await notificationQueue.isPaused();
    queueHealthy = !isPaused;
  } catch {
    queueHealthy = false;
  }

  let workerAlive = false;
  try {
    const hb = await redis.get('worker:heartbeat:email');
    workerAlive = !!hb;
  } catch {
    workerAlive = false;
  }

  const isCriticalHealthy = dbHealthy && redisHealthy;
  const isFullyHealthy = isCriticalHealthy && queueHealthy;

  // Critical dependencies down -> 503; Queue glitch alone -> 200 (degraded)
  const httpStatus = isCriticalHealthy ? 200 : 503;
  const overallStatus = isFullyHealthy ? 'healthy' : isCriticalHealthy ? 'degraded' : 'unhealthy';

  res.status(httpStatus).json({
    success: isCriticalHealthy,
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime() * 100) / 100,
    services: {
      database: {
        status: dbHealthy ? 'connected' : 'disconnected',
        responseTimeMs: dbHealthy ? dbResponseTimeMs : null,
      },
      redis: {
        status: redisHealthy ? 'connected' : 'disconnected',
        responseTimeMs: redisHealthy ? redisResponseTimeMs : null,
      },
      workerQueue: {
        status: queueHealthy ? 'ready' : 'unavailable',
        workerAlive,
      },
    },
  });
});

export default router;
