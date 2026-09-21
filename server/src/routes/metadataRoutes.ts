import * as cheerio from 'cheerio';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { fetchPage } from '../crawler/fetchPage.js';
import { extractEmails } from '../extractors/emails.js';
import { extractLinks } from '../extractors/links.js';
import { extractMetadata } from '../extractors/metadata.js';
import { extractSocialLinks } from '../extractors/social.js';
import { extractContent } from '../extractors/content.js';
import { detectTechStack } from '../extractors/techStack.js';
import { extractJobPosting } from '../extractors/metadata.js';
import { renderPageSnapshot } from '../crawler/renderPage.js';
import { normalizeUrl } from '../utils/url.js';
import { config } from '../config/index.js';
import { withCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

interface HttpError extends Error {
  status?: number;
}

export function metadataRouter() {
  const router = Router();

  router.post('/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hasRender = req.body?.render !== undefined;
      if (hasRender && typeof req.body.render !== 'boolean') {
        const error: HttpError = new Error('render must be a boolean');
        error.status = 400;
        throw error;
      }
      const render = Boolean(req.body?.render);
      if (render && config.crawlerRenderConcurrency === 0) {
        return res.status(400).json({
          error: 'RENDER_DISABLED',
          message: 'JavaScript rendering is not enabled on this server'
        });
      }
      const extract = req.body?.extract as {
        metadata?: boolean;
        emails?: boolean;
        social?: boolean;
        images?: boolean;
        links?: boolean;
        content?: boolean;
        techStack?: boolean;
      } | undefined;
      const hasExtract = extract !== undefined;
      if (hasExtract && (!extract || typeof extract !== 'object' || Array.isArray(extract))) {
        const error: HttpError = new Error('extract must be an object');
        error.status = 400;
        throw error;
      }
      const extractFields = ['metadata', 'emails', 'social', 'images', 'links', 'content', 'techStack'] as const;
      if (hasExtract && extractFields.some((field) => extract[field] !== undefined && typeof extract[field] !== 'boolean')) {
        const error: HttpError = new Error('extract fields must be boolean');
        error.status = 400;
        throw error;
      }
      const runAll = !hasExtract || extractFields.every((field) => extract?.[field] === undefined);
      if (hasExtract && !runAll && !extractFields.some((field) => extract?.[field] === true)) {
        const error: HttpError = new Error('At least one extract field must be true');
        error.status = 400;
        throw error;
      }
      const defaultFields = new Set(['metadata', 'emails', 'social', 'images', 'links']);
      const shouldExtract = (field: typeof extractFields[number]) => runAll
        ? defaultFields.has(field)
        : extract?.[field] === true;
      const url = normalizeUrl(req.body?.url);
      if (!url) {
        const error: HttpError = new Error('A valid URL is required');
        error.status = 400;
        throw error;
      }

      const baseCacheKey = runAll ? `metadata:preview:${url}` : `metadata:preview:${url}:${JSON.stringify(extract)}`;
      const cacheKey = render ? `${baseCacheKey}:rendered` : baseCacheKey;
      const preview = await withCache(cacheKey, config.cacheTtlMetadataPreviewMs, async () => {
        const html = await fetchPage(url, 1);
        const staticResult = extractPreview(html, url, shouldExtract);
        let result = staticResult;
        let renderedSuccessfully = false;

        if (render) {
          try {
            const renderedSnapshot = await renderPageSnapshot(url);
            if (renderedSnapshot) {
              result = mergePreviewResults(staticResult, extractPreview(renderedSnapshot.html, url, shouldExtract));
              renderedSuccessfully = true;
            } else {
              logger.warn({ url }, 'Preview JavaScript rendering returned no snapshot; using static result');
            }
          } catch (error) {
            logger.warn({ url, err: error instanceof Error ? error.message : String(error) }, 'Preview JavaScript rendering failed; using static result');
          }
        }

        result.url = url;
        if (hasRender) result.rendered = renderedSuccessfully;
        result.fetchedAt = new Date().toISOString();
        return result;
      });

      if (hasRender && preview && typeof preview === 'object' && !Array.isArray(preview)) {
        (preview as Record<string, unknown>).rendered ??= false;
      }

      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

type ExtractorName = 'metadata' | 'emails' | 'social' | 'images' | 'links' | 'content' | 'techStack';
type PreviewResult = Record<string, any>;

function extractPreview(
  html: string,
  url: string,
  shouldExtract: (field: ExtractorName) => boolean
): PreviewResult {
  const $ = cheerio.load(html);
  const result: PreviewResult = { url };
  const links = shouldExtract('links')
    ? extractLinks($, url, { includeMetaLinks: true })
    : undefined;
  const socialLinks = shouldExtract('social')
    ? links || extractLinks($, url, { includeMetaLinks: true })
    : [];

  if (shouldExtract('metadata')) {
    result.metadata = extractMetadata($, url);
    const jobPosting = extractJobPosting($, url);
    if (jobPosting) result.jobPosting = jobPosting;
  }
  if (shouldExtract('links')) result.links = links;
  if (shouldExtract('emails')) result.emails = extractEmails(html);
  if (shouldExtract('social')) result.social = extractSocialLinks(socialLinks);
  if (shouldExtract('images')) result.images = extractImages($, url);
  if (shouldExtract('content')) result.content = extractContent($);
  if (shouldExtract('techStack')) result.techStack = detectTechStack($, {}, html);

  return result;
}

function mergePreviewResults(staticResult: PreviewResult, renderedResult: PreviewResult) {
  const result: PreviewResult = { ...staticResult };

  if (staticResult.metadata || renderedResult.metadata) {
    result.metadata = mergeRecords(staticResult.metadata || {}, renderedResult.metadata || {});
  }
  if (staticResult.jobPosting || renderedResult.jobPosting) {
    result.jobPosting = renderedResult.jobPosting || staticResult.jobPosting;
  }

  for (const field of ['links', 'emails', 'images', 'techStack']) {
    if (staticResult[field] || renderedResult[field]) {
      result[field] = mergeArrays(staticResult[field] || [], renderedResult[field] || []);
    }
  }
  if (staticResult.social || renderedResult.social) {
    result.social = mergeRecords(staticResult.social || {}, renderedResult.social || {});
  }
  if (staticResult.content || renderedResult.content) {
    result.content = mergeRecords(staticResult.content || {}, renderedResult.content || {});
  }

  return result;
}

function mergeRecords(staticValue: Record<string, any>, renderedValue: Record<string, any>) {
  const result: Record<string, any> = { ...staticValue };
  for (const [key, rendered] of Object.entries(renderedValue)) {
    const current = result[key];
    if (Array.isArray(current) || Array.isArray(rendered)) {
      result[key] = mergeArrays(current || [], rendered || []);
    } else if (rendered && typeof rendered === 'object' && current && typeof current === 'object') {
      result[key] = mergeRecords(current, rendered);
    } else if (hasValue(rendered)) {
      result[key] = rendered;
    }
  }
  return result;
}

function mergeArrays(staticValue: unknown[], renderedValue: unknown[]) {
  const values = [...staticValue, ...renderedValue];
  return values.filter((value, index) => values.findIndex((item) => JSON.stringify(item) === JSON.stringify(value)) === index);
}

function hasValue(value: unknown) {
  return Array.isArray(value)
    ? value.length > 0
    : typeof value === 'string'
      ? value.trim().length > 0
      : value !== null && value !== undefined;
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
