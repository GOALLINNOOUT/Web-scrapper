import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { redisConnection } from '../queue/connection.js';

const memoryBuckets = new Map<string, number[]>();
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 1
  if oldest[2] then
    retry_after = math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
  end
  return {0, count, retry_after}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, count + 1, 0}
`;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = `ratelimit:${req.deviceId || req.ip}`;
  const now = Date.now();
  const maxRequests = getLimit(req);

  try {
    if (process.env.REDIS_URL) {
      const redis = redisConnection();
      const member = `${now}-${req.requestId || Math.random()}`;
      const result = await redis.eval(RATE_LIMIT_SCRIPT, 1, key, now, config.rateLimitWindowMs, maxRequests, member) as [number, number, number];
      return finish(req, res, next, Number(result[1] || 0), maxRequests, Number(result[0]) === 1, Number(result[2] || 0));
    }

    const bucket = (memoryBuckets.get(key) || []).filter((value) => value > now - config.rateLimitWindowMs);
    bucket.push(now);
    memoryBuckets.set(key, bucket);
    return finish(req, res, next, bucket.length, maxRequests);
  } catch (error) {
    next();
  }
}

function finish(_req: Request, res: Response, next: NextFunction, count: number, maxRequests: number, allowed = count <= maxRequests, retryAfter = 60) {
  res.set({
    'X-RateLimit-Limit': String(maxRequests),
    'X-RateLimit-Remaining': String(Math.max(0, maxRequests - count)),
    'X-RateLimit-Reset': new Date(Date.now() + config.rateLimitWindowMs).toISOString()
  });

  if (!allowed) {
    res.set('Retry-After', String(retryAfter || 60));
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry after the current window resets.'
    });
  }

  next();
}

function getLimit(req: Request) {
  const tier = String(req.header('X-Workspace-Tier') || '').toLowerCase();
  if (tier === 'enterprise') return config.rateLimitEnterprise;
  if (tier === 'pro') return config.rateLimitPro;
  return config.rateLimitDefault;
}
