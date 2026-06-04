import type { CheerioAPI } from 'cheerio';
import { isLikelyPageUrl, normalizeUrl } from '../utils/url.js';

const META_LINK_RELS = new Set(['canonical', 'alternate', 'next', 'prev']);
const MAX_EXTRACTED_LINKS = Number(process.env.CRAWLER_MAX_EXTRACTED_LINKS || 1000);

export function extractLinks($: CheerioAPI, baseUrl: string, options: { includeMetaLinks?: boolean } = {}) {
  const links = new Set<string>();

  $('[href]').each((_index, element) => {
    if (links.size >= MAX_EXTRACTED_LINKS) return false;
    if (element.tagName?.toLowerCase() === 'link') return;
    const href = $(element).attr('href');
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized && isLikelyPageUrl(normalized)) links.add(normalized);
  });

  if (options.includeMetaLinks) {
    $('link[href]').each((_index, element) => {
      if (links.size >= MAX_EXTRACTED_LINKS) return false;
      const rels = String($(element).attr('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!rels.some((rel) => META_LINK_RELS.has(rel))) return;

      const href = $(element).attr('href');
      const normalized = normalizeUrl(href, baseUrl);
      if (normalized && isLikelyPageUrl(normalized)) links.add(normalized);
    });
  }

  return [...links];
}
