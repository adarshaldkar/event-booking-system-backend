import Redis from 'ioredis';
import { env } from './env';

// Shared Redis connection used by both API and BullMQ
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('connect', () => console.log('✅  Redis connected'));
redis.on('error', (err) => console.error('❌  Redis error:', err.message));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  console.log('🔌  Redis disconnected');
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
