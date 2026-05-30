import { config } from '../config/index.js';
import { redisConnection } from '../queue/connection.js';

const SLOT_TTL_MS = 30_000;

export async function waitForDomainTurn(domain: string) {
  if (!config.redisUrl) return () => undefined;
  await waitForDomainRate(domain);
  return acquireDomainSlot(domain);
}

async function waitForDomainRate(domain: string) {
  const redis = redisConnection();
  const key = `domain-rate:${domain}:${Math.floor(Date.now() / 1000)}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, 1500);
    if (count <= config.crawlerDomainRatePerSecond) return;
    await sleep(100 + attempt * 25);
  }
}

async function acquireDomainSlot(domain: string) {
  const redis = redisConnection();
  const key = `domain-slots:${domain}`;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, SLOT_TTL_MS);
    if (count <= config.crawlerDomainConcurrency) {
      return async () => {
        await redis.decr(key).catch(() => undefined);
      };
    }
    await redis.decr(key).catch(() => undefined);
    await sleep(100 + attempt * 20);
  }

  throw new Error(`DOMAIN_THROTTLED: ${domain}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
