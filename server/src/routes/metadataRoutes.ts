import * as cheerio from 'cheerio';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { fetchPage } from '../crawler/fetchPage.js';
import { extractEmails } from '../extractors/emails.js';
import { extractLinks } from '../extractors/links.js';
import { extractMetadata } from '../extractors/metadata.js';
import { extractSocialLinks } from '../extractors/social.js';
import { normalizeUrl } from '../utils/url.js';
import { config } from '../config/index.js';
import { withCache } from '../utils/cache.js';

interface HttpError extends Error {
  status?: number;
}

export function metadataRouter() {
  const router = Router();

  router.post('/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const url = normalizeUrl(req.body?.url);
      if (!url) {
        const error: HttpError = new Error('A valid URL is required');
        error.status = 400;
        throw error;
      }

      const preview = await withCache(`metadata:preview:${url}`, config.cacheTtlMetadataPreviewMs, async () => {
        const html = await fetchPage(url, 1);
        const $ = cheerio.load(html);
        const metadata = extractMetadata($, url);
        const links = extractLinks($, url, { includeMetaLinks: true });
        const emails = extractEmails(html);
        const social = extractSocialLinks(links);
        const images = extractImages($, url);

        return {
          url,
          metadata,
          links,
          emails,
          social,
          images,
          fetchedAt: new Date().toISOString()
        };
      });

      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function extractImages($: cheerio.CheerioAPI, baseUrl: string) {
  const images = new Set<string>();

  $('img[src], meta[property="og:image"], meta[name="twitter:image"]').each((_index, element) => {
    const value = $(element).attr('src') || $(element).attr('content');
    const normalized = normalizeUrl(value, baseUrl);
    if (normalized) images.add(normalized);
  });

  return [...images];
}
