import { config } from '../config/index.js';
import { redisConnection } from '../queue/connection.js';
import { logger } from './logger.js';

const pendingCacheReads = new Map<string, Promise<unknown>>();

export function cacheEnabled() {
  return Boolean(config.redisUrl);
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  if (!cacheEnabled()) return null;
  try {
    const cached = await redisConnection().get(key);
    return cached ? JSON.parse(cached) as T : null;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error), key }, 'Cache read failed');
    return null;
  }
}

export async function setCachedJson(key: string, value: unknown, ttlMs: number) {
  if (!cacheEnabled() || ttlMs <= 0) return;
  try {
    await redisConnection().set(key, JSON.stringify(value), 'PX', ttlMs);
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error), key }, 'Cache write failed');
  }
}

export async function withCache<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
  const cached = await getCachedJson<T>(key);
  if (cached !== null) return cached;

  const pending = pendingCacheReads.get(key);
  if (pending) return pending as Promise<T>;

  const promise = producer()
    .then(async (value) => {
      await setCachedJson(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      pendingCacheReads.delete(key);
    });

  pendingCacheReads.set(key, promise);
  return promise;
}

export async function invalidateCachePatterns(patterns: string[]) {
  if (!cacheEnabled() || patterns.length === 0) return;
  const redis = redisConnection();
  try {
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error), patterns }, 'Cache invalidation failed');
  }
}

export function stableCacheKey(prefix: string, input: Record<string, unknown>) {
  return `${prefix}:${Object.keys(input).sort().map((key) => `${key}=${JSON.stringify(input[key])}`).join('&')}`;
}
