import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { CrawlJob } from '../models/CrawlJob.js';
import { Page } from '../models/Page.js';
import { cursorFilter, parseLimit, toCursorPage } from '../lib/pagination.js';
import type { CrawlManager } from '../crawler/CrawlManager.js';
import { CrawlSummary } from '../models/CrawlSummary.js';
import { rebuildCrawlSummary } from '../services/crawlSummaryService.js';
import { config } from '../config/index.js';
import { stableCacheKey, withCache } from '../utils/cache.js';
import { decryptPageDocument } from '../services/changePayloadCrypto.js';
import { timeMongoOperation } from '../utils/metrics.js';

const COMPACT_PAGE_PROJECTION = {
  content: 0,
  compressedContent: 0,
  searchText: 0
};

const CRAWL_LIST_PROJECTION = {
  seedUrl: 1,
  status: 1,
  config: 1,
  pagesCrawled: 1,
  emailsFound: 1,
  socialLinksFound: 1,
  requestedStop: 1,
  requestedPause: 1,
  error: 1,
  createdAt: 1,
  updatedAt: 1,
  startedAt: 1,
  completedAt: 1,
  durationMs: 1,
  deviceId: 1
};

export function crawlRouter({ crawlManager }: { crawlManager: CrawlManager }) {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await crawlManager.createJob(req.body, req.deviceId);
      res.status(201).json(job);
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const jobs = await withCache(`crawl:list:${_req.deviceId}`, config.cacheTtlCrawlMs, () => (
        timeMongoOperation('list', 'crawljobs', () => CrawlJob.find({ deviceId: _req.deviceId }, CRAWL_LIST_PROJECTION)
          .sort({ createdAt: -1 })
          .limit(100)
          .lean())
      ));
      res.json(jobs);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await timeMongoOperation('detail', 'crawljobs', () => CrawlJob.findOne({ _id: req.params.id, deviceId: req.deviceId }, CRAWL_LIST_PROJECTION).lean());
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/results', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseLimit(req.query.limit, 25, 100);
      const cursor = cursorFilter(req.query.cursor);
      const query = {
        $and: [
          { deviceId: req.deviceId, crawlId: req.params.id },
          ...(cursor ? [cursor] : [])
        ]
      };
      const includeFull = req.query.include === 'full';
      const cacheKey = stableCacheKey(`crawl:results:${req.deviceId}:${req.params.id}`, {
        limit,
        cursor: req.query.cursor || '',
        include: includeFull ? 'full' : 'compact'
      });
      const resultPromise = (includeFull ? readResults() : withCache(cacheKey, config.cacheTtlDataMs, readResults));
      async function readResults() {
        const pages = await timeMongoOperation('crawlResults', 'pages', () => Page.find(query, includeFull ? undefined : COMPACT_PAGE_PROJECTION)
          .sort({ crawledAt: -1, _id: -1 })
          .limit(limit + 1)
          .lean());

        return toCursorPage(includeFull ? pages.map((page) => decryptPageDocument(page)) : pages, limit);
      }
      const [job, result] = await Promise.all([
        timeMongoOperation('exists', 'crawljobs', () => CrawlJob.exists({ _id: req.params.id, deviceId: req.deviceId })),
        resultPromise
      ]);

      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await timeMongoOperation('summaryJob', 'crawljobs', () => CrawlJob.findOne({ _id: req.params.id, deviceId: req.deviceId }, CRAWL_LIST_PROJECTION).lean());
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });

      const summary = await withCache(`crawl:summary:${req.deviceId}:${req.params.id}`, config.cacheTtlDataMs, async () => {
        const existing = await timeMongoOperation('summary', 'crawlsummaries', () => CrawlSummary.findOne({ deviceId: req.deviceId, crawlId: req.params.id }).lean());
        if (!existing) return rebuildCrawlSummary(req.deviceId, String(req.params.id));

        const hasRawEmails = (job.emailsFound || 0) > 0 || (existing.counts?.rawEmailOccurrences || 0) > 0;
        const hasRawSocials = (job.socialLinksFound || 0) > 0 || (existing.counts?.rawSocialOccurrences || 0) > 0;
        const missingEmailSummary = hasRawEmails && (existing.emails || []).length === 0 && (existing.emailOccurrences || []).length === 0;
        const missingSocialSummary = hasRawSocials && (existing.socials || []).length === 0 && (existing.socialOccurrences || []).length === 0;
        return missingEmailSummary || missingSocialSummary
          ? rebuildCrawlSummary(req.deviceId, String(req.params.id))
          : existing;
      });

      res.json({
        crawlId: req.params.id,
        pagesCrawled: job.pagesCrawled || summary?.counts?.loadedPages || 0,
        emails: summary?.emails || [],
        emailOccurrences: summary?.emailOccurrences || [],
        socials: summary?.socials || [],
        socialOccurrences: summary?.socialOccurrences || [],
        techStack: summary?.techStack || [],
        counts: {
          uniqueEmails: summary?.counts?.uniqueEmails || 0,
          uniqueSocialProfiles: summary?.counts?.uniqueSocialProfiles || 0,
          uniqueTech: summary?.counts?.uniqueTech || 0,
          loadedPages: summary?.counts?.loadedPages || 0,
          rawEmailOccurrences: job.emailsFound || summary?.counts?.rawEmailOccurrences || 0,
          rawSocialOccurrences: job.socialLinksFound || summary?.counts?.rawSocialOccurrences || 0
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/stop', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await crawlManager.stopJob(String(req.params.id), req.deviceId);
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await crawlManager.pauseJob(String(req.params.id), req.deviceId);
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/continue', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await crawlManager.continueJob(String(req.params.id), req.deviceId);
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/resume', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await crawlManager.continueJob(String(req.params.id), req.deviceId);
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await crawlManager.retryJob(String(req.params.id), req.deviceId);
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Crawl job not found' });
      res.status(201).json(job);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
