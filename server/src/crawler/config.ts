import { normalizeUrl } from '../utils/url.js';
import type { CrawlConfig } from '../types.js';
import { config as appConfig } from '../config/index.js';

export const DEFAULT_EXTRACT = {
  links: true,
  emails: true,
  metadata: true,
  social: true,
  content: true
};

export const DEFAULT_DISCOVERY = {
  sitemap: true,
  renderJavaScript: true,
  renderWhenStaticLinksBelow: 20,
  includeMetaLinks: true
};

export type RawCrawlConfig = Partial<Omit<CrawlConfig, 'extract'>> & {
  extract?: Partial<CrawlConfig['extract']>;
  discovery?: Partial<CrawlConfig['discovery']>;
};

interface HttpError extends Error {
  status?: number;
}

export function normalizeCrawlConfig(input: RawCrawlConfig = {}): CrawlConfig {
  const seedUrl = normalizeUrl(input.seedUrl);
  if (!seedUrl) {
    const error: HttpError = new Error('A valid seedUrl is required');
    error.status = 400;
    throw error;
  }

  return {
    seedUrl,
    maxPages: clampNumber(input.maxPages, 1, appConfig.maxPagesPerJob, 100),
    maxDepth: clampNumber(input.maxDepth, 0, appConfig.maxCrawlDepth, 2),
    sameDomainOnly: input.sameDomainOnly !== false,
    concurrency: clampNumber(input.concurrency, 1, 10, 5),
    schedule: input.schedule || 'none',
    discovery: {
      ...DEFAULT_DISCOVERY,
      ...(input.discovery || {}),
      renderWhenStaticLinksBelow: clampNumber(input.discovery?.renderWhenStaticLinksBelow, 0, 100, DEFAULT_DISCOVERY.renderWhenStaticLinksBelow)
    },
    extract: {
      ...DEFAULT_EXTRACT,
      ...(input.extract || {})
    }
  };
}

export function withCrawlConfigDefaults(input: CrawlConfig): CrawlConfig {
  return {
    ...input,
    discovery: {
      ...DEFAULT_DISCOVERY,
      ...(input.discovery || {}),
      renderWhenStaticLinksBelow: clampNumber(input.discovery?.renderWhenStaticLinksBelow, 0, 100, DEFAULT_DISCOVERY.renderWhenStaticLinksBelow)
    },
    extract: {
      ...DEFAULT_EXTRACT,
      ...(input.extract || {})
    }
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
