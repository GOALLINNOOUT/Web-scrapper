import { config } from '../config/index.js';
import { redisConnection } from '../queue/connection.js';
import { normalizeUrl } from '../utils/url.js';

const TTL_SECONDS = 7 * 24 * 60 * 60;

export async function reserveCrawlUrls(crawlId: string, urls: string[]) {
  const normalized = [...new Set(urls.map((url) => normalizeUrl(url)).filter(Boolean) as string[])];
  if (normalized.length === 0) return [];
  if (!config.redisUrl) return normalized;

  const redis = redisConnection();
  const key = `dedupe:crawl:${crawlId}`;
  const pipeline = redis.pipeline();
  normalized.forEach((url) => pipeline.sadd(key, url));
  pipeline.expire(key, TTL_SECONDS);
  const results = await pipeline.exec();

  return normalized.filter((_url, index) => Number(results?.[index]?.[1] || 0) === 1);
}
