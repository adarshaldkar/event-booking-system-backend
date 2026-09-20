import { redis } from '../config/redis';
import { logger } from './logger';

export const CACHE_TTL = {
  EVENT_LIST: 60, // 60 seconds
  EVENT_DETAIL: 30, // 30 seconds
};

export class CacheService {
  /**
   * Get cached JSON payload
   */
  public async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
      return null;
    } catch (err: any) {
      logger.warn(`Redis GET cache error on key ${key}`, { error: err.message });
      return null;
    }
  }

  /**
   * Set JSON payload with TTL in seconds
   */
  public async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err: any) {
      logger.warn(`Redis SET cache error on key ${key}`, { error: err.message });
    }
  }

  /**
   * Delete single key
   */
  public async delete(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (err: any) {
      logger.warn(`Redis DEL cache error on key ${key}`, { error: err.message });
    }
  }

  /**
   * Non-blocking cache invalidation using Redis SCAN (avoids blocking KEYS command)
   */
  public async invalidateEventCache(eventId?: string): Promise<void> {
    try {
      // 1. Invalidate single event detail key
      if (eventId) {
        await redis.del(`events:detail:${eventId}`);
      }

      // 2. Non-blocking scan and delete matching events:list:* keys
      const stream = redis.scanStream({
        match: 'events:list:*',
        count: 100,
      });

      const keysToDelete: string[] = [];
      stream.on('data', (resultKeys: string[]) => {
        if (resultKeys.length > 0) {
          keysToDelete.push(...resultKeys);
        }
      });

      await new Promise<void>((resolve) => {
        stream.on('end', async () => {
          if (keysToDelete.length > 0) {
            await redis.del(...keysToDelete);
            logger.info(`🧹 Invalidation removed ${keysToDelete.length} list cache key(s)`);
          }
          resolve();
        });
      });
    } catch (err: any) {
      logger.warn('Failed to invalidate event cache', { error: err.message });
    }
  }
}

export const cacheService = new CacheService();
