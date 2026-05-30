import axios from 'axios';
import * as cheerio from 'cheerio';
import { isLikelyPageUrl, normalizeUrl } from '../utils/url.js';

const USER_AGENT = 'WebIntelligenceCrawler/1.0 (+https://localhost)';

export async function discoverSitemapUrls(seedUrl: string, maxUrls = 250): Promise<string[]> {
  const sitemapLocations = await sitemapCandidates(seedUrl);
  const discovered = new Set<string>();
  const visitedSitemaps = new Set<string>();
  const queue = [...sitemapLocations];

  while (queue.length > 0 && discovered.size < maxUrls) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);

    const xml = await fetchText(sitemapUrl).catch(() => null);
    if (!xml) continue;

    const parsed = parseSitemap(xml);
    for (const childSitemap of parsed.sitemaps) {
      if (!visitedSitemaps.has(childSitemap)) queue.push(childSitemap);
    }

    for (const url of parsed.urls) {
      discovered.add(url);
      if (discovered.size >= maxUrls) break;
    }
  }

  return [...discovered];
}

async function sitemapCandidates(seedUrl: string) {
  const origin = new URL(seedUrl).origin;
  const candidates = new Set<string>([`${origin}/sitemap.xml`]);
  const robots = await fetchText(`${origin}/robots.txt`).catch(() => '');

  for (const line of robots.split(/\r?\n/)) {
    const match = line.match(/^\s*sitemap:\s*(.+)\s*$/i);
    const normalized = normalizeUrl(match?.[1], origin);
    if (normalized) candidates.add(normalized);
  }

  return [...candidates];
}

async function fetchText(url: string) {
  const response = await axios.get(url, {
    timeout: 10_000,
    maxRedirects: 5,
    responseType: 'text',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/xml,text/xml,text/plain,*/*'
    },
    validateStatus: (status) => status >= 200 && status < 400
  });

  return String(response.data);
}

function parseSitemap(xml: string) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const urls = new Set<string>();
  const sitemaps = new Set<string>();

  $('url > loc').each((_index, element) => {
    const normalized = normalizeUrl($(element).text());
    if (normalized && isLikelyPageUrl(normalized)) urls.add(normalized);
  });

  $('sitemap > loc').each((_index, element) => {
    const normalized = normalizeUrl($(element).text());
    if (normalized) sitemaps.add(normalized);
  });

  return {
    urls: [...urls],
    sitemaps: [...sitemaps]
  };
}
