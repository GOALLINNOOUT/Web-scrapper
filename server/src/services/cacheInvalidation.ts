import { invalidateCachePatterns } from '../utils/cache.js';
import { publishLiveEvent } from './liveEvents.js';

export function invalidateWorkspaceReads(deviceId: string) {
  publishLiveEvent({ type: 'workspace.updated', deviceId }).catch(() => undefined);
  return invalidateCachePatterns([
    `crawl:list:${deviceId}`,
    `crawl:results:${deviceId}:*`,
    `crawl:summary:${deviceId}:*`,
    `data:${deviceId}:*`,
    `domain:list:${deviceId}:*`,
    `monitoring:${deviceId}*`
  ]);
}

export function invalidateCrawlReads(deviceId: string, crawlId: string, options: { publish?: boolean } = {}) {
  if (options.publish !== false) {
    publishLiveEvent({ type: 'crawl.updated', deviceId, crawlId }).catch(() => undefined);
  }

  return invalidateCachePatterns([
    `crawl:list:${deviceId}`,
    `crawl:results:${deviceId}:${crawlId}:*`,
    `crawl:summary:${deviceId}:${crawlId}`,
    `data:${deviceId}:*`,
    `monitoring:${deviceId}*`
  ]);
}

export function invalidateDomainReads(deviceId: string) {
  publishLiveEvent({ type: 'domain.updated', deviceId }).catch(() => undefined);
  return invalidateCachePatterns([
    `domain:list:${deviceId}:*`,
    `monitoring:${deviceId}*`
  ]);
}
