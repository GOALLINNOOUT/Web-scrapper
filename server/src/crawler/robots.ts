import { fetchPage } from './fetchPage.js';
import { redisConnection } from '../queue/connection.js';
import { config } from '../config/index.js';

const memoryCache = new Map<string, { value: string; expiresAt: number }>();
const TTL_SECONDS = 24 * 60 * 60;

export async function isAllowedByRobots(url: string, respectRobots = config.crawlerRespectRobots) {
  if (!respectRobots) return true;

  try {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const robots = await getRobots(robotsUrl);
    if (!robots) return true;

    const disallowed = parseDisallowRules(robots);
    const path = `${parsed.pathname}${parsed.search}`;
    return !disallowed.some((rule) => path.startsWith(rule));
  } catch {
    return true;
  }
}

async function getRobots(robotsUrl: string) {
  const key = `robots:${robotsUrl}`;
  if (config.redisUrl) {
    const redis = redisConnection();
    const cached = await redis.get(key);
    if (cached !== null) return cached;
    const value = await fetchPage(robotsUrl, 0).catch(() => '');
    await redis.set(key, value, 'EX', TTL_SECONDS);
    return value;
  }

  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchPage(robotsUrl, 0).catch(() => '');
  memoryCache.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  return value;
}

function parseDisallowRules(robots: string) {
  const rules: string[] = [];
  let applies = false;

  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() || '';
    if (!line) continue;
    const [field = '', ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (/^user-agent$/i.test(field)) {
      applies = value === '*';
    } else if (applies && /^disallow$/i.test(field) && value) {
      rules.push(value);
    }
  }

  return rules;
}
