import { Redis } from 'ioredis';

let connection: Redis | null = null;

export function createRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for Redis-backed features');
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    keepAlive: 30_000,
    connectTimeout: 10_000,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 200, 3000);
    },
    reconnectOnError: (error) => ['READONLY', 'ECONNRESET', 'ETIMEDOUT'].some((code) => error.message.includes(code))
  });
}

export function redisConnection() {
  if (!connection) {
    connection = createRedisConnection();
  }
  return connection;
}
