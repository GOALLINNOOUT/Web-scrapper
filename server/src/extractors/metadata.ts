import type { CheerioAPI } from 'cheerio';
import type { Metadata } from '../types.js';

function attr($: CheerioAPI, selector: string, attribute: string) {
  return ($(selector).first().attr(attribute) || '').trim();
}

function meta($: CheerioAPI, name: string) {
  return attr($, `meta[name="${name}"], meta[property="${name}"]`, 'content');
}

function text($: CheerioAPI, selector: string) {
  return ($(selector).first().text() || '').trim();
}

export function extractMetadata($: CheerioAPI, baseUrl?: string): Metadata {
  const title = text($, 'title');
  const description = meta($, 'description');
  const ogImage = resolveMaybe(attr($, 'meta[property="og:image"]', 'content'), baseUrl);
  const twitterImage = resolveMaybe(meta($, 'twitter:image'), baseUrl);
  const keywords = splitKeywords(meta($, 'keywords'));
  const canonical = canonicalUrl(resolveMaybe(attr($, 'link[rel="canonical"]', 'href'), baseUrl), baseUrl);
  const ogUrl = canonicalUrl(resolveMaybe(attr($, 'meta[property="og:url"]', 'content'), baseUrl), baseUrl);

  return {
    title,
    description,
    canonical,
    language: attr($, 'html', 'lang'),
    viewport: meta($, 'viewport'),
    robots: meta($, 'robots') || meta($, 'googlebot'),
    author: meta($, 'author') || attr($, 'link[rel="author"]', 'href'),
    publisher: meta($, 'publisher') || attr($, 'link[rel="publisher"]', 'href'),
    generator: meta($, 'generator'),
    applicationName: meta($, 'application-name') || meta($, 'apple-mobile-web-app-title'),
    keywords,
    themeColor: meta($, 'theme-color') || meta($, 'msapplication-TileColor'),
    favicon: favicon($, baseUrl),
    manifest: resolveMaybe(attr($, 'link[rel="manifest"]', 'href'), baseUrl),
    ampUrl: resolveMaybe(attr($, 'link[rel="amphtml"]', 'href'), baseUrl),
    alternateLanguages: alternateLanguages($, baseUrl),
    ogUrl,
    ogType: attr($, 'meta[property="og:type"]', 'content'),
    ogTitle: attr($, 'meta[property="og:title"]', 'content'),
    ogDescription: attr($, 'meta[property="og:description"]', 'content'),
    ogImage,
    siteName: attr($, 'meta[property="og:site_name"]', 'content'),
    twitterCard: meta($, 'twitter:card'),
    twitterSite: meta($, 'twitter:site'),
    twitterCreator: meta($, 'twitter:creator'),
    twitterTitle: meta($, 'twitter:title'),
    twitterDescription: meta($, 'twitter:description'),
    twitterImage,
    jsonLdTypes: jsonLdTypes($)
  };
}

function canonicalUrl(value: string, baseUrl?: string) {
  if (!baseUrl) return value;
  if (!value) return baseUrl;
  try {
    const current = new URL(baseUrl);
    const canonical = new URL(value);
    const canonicalIsSiteRoot = canonical.origin === current.origin && canonical.pathname.replace(/\/+$/, '') === '';
    const currentIsDeeperRoute = current.pathname.replace(/\/+$/, '') !== '';
    if (canonicalIsSiteRoot && currentIsDeeperRoute) return current.toString();
    return canonical.toString();
  } catch {
    return value;
  }
}

function resolveMaybe(value: string, baseUrl?: string) {
  if (!value || !baseUrl) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function splitKeywords(value: string) {
  return value.split(',').map((keyword) => keyword.trim()).filter(Boolean).slice(0, 30);
}

function favicon($: CheerioAPI, baseUrl?: string) {
  const value = attr($, 'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]', 'href');
  return resolveMaybe(value, baseUrl);
}

function alternateLanguages($: CheerioAPI, baseUrl?: string) {
  const alternates: Array<{ hrefLang: string; href: string }> = [];
  $('link[rel="alternate"][hreflang][href]').each((_index, element) => {
    const hrefLang = ($(element).attr('hreflang') || '').trim();
    const href = resolveMaybe(($(element).attr('href') || '').trim(), baseUrl);
    if (hrefLang && href) alternates.push({ hrefLang, href });
  });
  return alternates.slice(0, 25);
}

function jsonLdTypes($: CheerioAPI) {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;
    try {
      collectJsonLdTypes(JSON.parse(raw), types);
    } catch {
      // Ignore malformed structured data; crawls should not fail over metadata hints.
    }
  });
  return [...types].sort().slice(0, 30);
}

function collectJsonLdTypes(value: unknown, output: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdTypes(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') output.add(type);
  if (Array.isArray(type)) type.filter((item): item is string => typeof item === 'string').forEach((item) => output.add(item));
  if (record['@graph']) collectJsonLdTypes(record['@graph'], output);
}
