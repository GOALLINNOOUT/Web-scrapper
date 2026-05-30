import type { ClientLiveEvent } from '../hooks/useLiveEvents.js';
import type { CrawlJob, CrawlPage } from '../types.js';

export function parseLiveCrawlPage(event: ClientLiveEvent): LiveCrawlPagePayload | null {
  if (event.type !== 'crawl.page') return null;
  if (!event.data || typeof event.data !== 'object') return null;

  const payload = event.data as { page?: unknown; job?: unknown };
  if (!payload.page || typeof payload.page !== 'object') return null;

  return {
    page: payload.page as CrawlPage,
    job: payload.job && typeof payload.job === 'object' ? payload.job as LiveCrawlJobPatch : undefined
  };
}

export function parseLiveCrawlJob(event: ClientLiveEvent): LiveCrawlJobPatch | null {
  if (event.type !== 'crawl.updated') return null;
  if (!event.data || typeof event.data !== 'object') return null;

  const payload = event.data as { job?: unknown };
  return payload.job && typeof payload.job === 'object' ? payload.job as LiveCrawlJobPatch : null;
}

export function parseLiveCrawlJobSnapshot(event: ClientLiveEvent): CrawlJob | null {
  const job = parseLiveCrawlJob(event);
  return job && typeof job._id === 'string' && job.seedUrl && job.config ? job as CrawlJob : null;
}

export function mergeLivePage(pages: CrawlPage[], page: CrawlPage, limit?: number) {
  const existingIndex = pages.findIndex((item) => item._id === page._id || item.url === page.url);
  const next = existingIndex >= 0
    ? pages.map((item, index) => index === existingIndex ? page : item)
    : [page, ...pages];

  const sorted = next.sort((left, right) => new Date(right.crawledAt).getTime() - new Date(left.crawledAt).getTime());
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

export function applyLiveJobPatch(job: CrawlJob, patch?: LiveCrawlJobPatch) {
  if (!patch) return job;

  return {
    ...job,
    pagesCrawled: typeof patch.pagesCrawled === 'number'
      ? patch.pagesCrawled
      : job.pagesCrawled + (patch.pagesCrawledDelta || 0),
    emailsFound: typeof patch.emailsFound === 'number'
      ? patch.emailsFound
      : job.emailsFound + (patch.emailsFoundDelta || 0),
    socialLinksFound: typeof patch.socialLinksFound === 'number'
      ? patch.socialLinksFound
      : job.socialLinksFound + (patch.socialLinksFoundDelta || 0),
    status: isCrawlStatus(patch.status) ? patch.status : job.status,
    updatedAt: new Date().toISOString()
  };
}

export function patchJobList(jobs: CrawlJob[], crawlId: string | undefined, patch?: LiveCrawlJobPatch) {
  if (!crawlId || !patch) return jobs;
  return jobs.map((job) => job._id === crawlId ? applyLiveJobPatch(job, patch) : job);
}

export function upsertJobList(jobs: CrawlJob[], job: CrawlJob) {
  const existingIndex = jobs.findIndex((item) => item._id === job._id);
  const next = existingIndex >= 0
    ? jobs.map((item, index) => index === existingIndex ? { ...item, ...job } : item)
    : [job, ...jobs];

  return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function isCrawlStatus(value: unknown): value is CrawlJob['status'] {
  return typeof value === 'string' && ['queued', 'running', 'paused', 'completed', 'stopped', 'failed'].includes(value);
}

export interface LiveCrawlPagePayload {
  page: CrawlPage;
  job?: LiveCrawlJobPatch;
}

export interface LiveCrawlJobPatch {
  _id?: string;
  seedUrl?: string;
  config?: CrawlJob['config'];
  createdAt?: string;
  updatedAt?: string;
  pagesCrawled?: number;
  emailsFound?: number;
  socialLinksFound?: number;
  pagesCrawledDelta?: number;
  emailsFoundDelta?: number;
  socialLinksFoundDelta?: number;
  status?: unknown;
}
