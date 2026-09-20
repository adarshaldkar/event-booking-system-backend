import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { checkRedisHealth } from '../config/redis';

const router = Router();

/**
 * GET /health
 * Reports status of PostgreSQL, Redis, and overall API health.
 */
router.get('/', async (_req: Request, res: Response) => {
  const dbHealthy = await prisma.$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);

  const redisHealthy = await checkRedisHealth();

  const status = dbHealthy && redisHealthy ? 'healthy' : 'degraded';

  res.status(status === 'healthy' ? 200 : 503).json({
    success: true,
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'connected' : 'disconnected',
      redis: redisHealthy ? 'connected' : 'disconnected',
    },
  });
});

export default router;
