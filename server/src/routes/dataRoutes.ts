import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { FilterQuery } from 'mongoose';
import { cursorFilter, parseLimit, toCursorPage } from '../lib/pagination.js';
import { Page } from '../models/Page.js';
import type { IPage } from '../models/Page.js';
import { SOCIAL_KEYS } from '../extractors/social.js';
import { config } from '../config/index.js';
import { stableCacheKey, withCache } from '../utils/cache.js';
import { decryptPageDocument } from '../services/changePayloadCrypto.js';
import { timeMongoOperation } from '../utils/metrics.js';

const COMPACT_PAGE_PROJECTION = {
  content: 0,
  compressedContent: 0,
  searchText: 0
};

export function dataRouter() {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const conditions: FilterQuery<IPage>[] = [{ deviceId: req.deviceId }];
      const { domain, hasEmails, hasSocial, q, classification, techStack, minScore } = req.query;

      if (q) {
        conditions.push(textSearchCondition(q));
      }

      if (domain) {
        conditions.push({ domain: { $regex: String(domain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
      }

      if (hasEmails === 'true') {
        conditions.push({ 'emails.0': { $exists: true } });
      }

      if (hasSocial === 'true') {
        conditions.push({ $or: SOCIAL_KEYS.map((key) => ({ [`social.${key}.0`]: { $exists: true } })) });
      }

      if (classification) {
        conditions.push({ 'classification.pageType': String(classification) });
      }

      if (techStack) {
        conditions.push({ techStack: { $in: String(techStack).split(',').map((value) => value.trim()).filter(Boolean) } });
      }

      if (minScore) {
        conditions.push({ score: { $gte: Math.max(0, Math.min(100, Number(minScore) || 0)) } });
      }

      const cursor = cursorFilter(req.query.cursor);
      if (cursor) conditions.push(cursor);

      const limit = parseLimit(req.query.limit, 25, 100);
      const query: FilterQuery<IPage> = { $and: conditions };
      const includeFull = req.query.include === 'full';
      const canCache = !req.query.cursor && !includeFull;
      const cacheKey = stableCacheKey(`data:${req.deviceId}`, {
        ...req.query,
        include: includeFull ? 'full' : 'compact'
      });
      const response = await (canCache ? withCache(cacheKey, config.cacheTtlDataMs, readData) : readData());
      res.json(response);

      async function readData() {
        const projection = includeFull ? undefined : COMPACT_PAGE_PROJECTION;
        try {
          const pages = await timeMongoOperation('list', 'pages', () => Page.find(query, projection)
            .sort({ crawledAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean());
          return toCursorPage(includeFull ? pages.map((page) => decryptPageDocument(page)) : pages, limit);
        } catch (error) {
          if (!q || !isMissingTextIndexError(error)) throw error;
          const fallbackQuery: FilterQuery<IPage> = {
            $and: conditions.map((condition) => hasTextSearch(condition) ? regexSearchCondition(q) : condition)
          };
          const pages = await timeMongoOperation('fallbackSearch', 'pages', () => Page.find(fallbackQuery, projection)
            .sort({ crawledAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean());
          return toCursorPage(includeFull ? pages.map((page) => decryptPageDocument(page)) : pages, limit);
        }
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function textSearchCondition(q: unknown): FilterQuery<IPage> {
  return { $text: { $search: String(q) } } as FilterQuery<IPage>;
}

function regexSearchCondition(q: unknown): FilterQuery<IPage> {
  const pattern = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: [
    { url: { $regex: pattern, $options: 'i' } },
    { domain: { $regex: pattern, $options: 'i' } },
    { searchText: { $regex: pattern, $options: 'i' } },
    { 'metadata.title': { $regex: pattern, $options: 'i' } },
    { 'metadata.description': { $regex: pattern, $options: 'i' } },
    { emails: { $regex: pattern, $options: 'i' } },
    { links: { $regex: pattern, $options: 'i' } },
    ...SOCIAL_KEYS.map((key) => ({ [`social.${key}`]: { $regex: pattern, $options: 'i' } }))
  ] } as FilterQuery<IPage>;
}

function hasTextSearch(condition: FilterQuery<IPage>) {
  return Boolean((condition as Record<string, unknown>).$text);
}

function isMissingTextIndexError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('text index required for $text query');
}
