import type { CheerioAPI } from 'cheerio';
import type { JobPostingData, Metadata } from '../types.js';

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
    title: decodeHtmlEntities(title),
    description: decodeHtmlEntities(description),
    canonical,
    language: attr($, 'html', 'lang'),
    viewport: meta($, 'viewport'),
    robots: meta($, 'robots') || meta($, 'googlebot'),
    author: decodeHtmlEntities(meta($, 'author') || attr($, 'link[rel="author"]', 'href')),
    publisher: decodeHtmlEntities(meta($, 'publisher') || attr($, 'link[rel="publisher"]', 'href')),
    generator: meta($, 'generator'),
    applicationName: meta($, 'application-name') || meta($, 'apple-mobile-web-app-title'),
    keywords: keywords.map(decodeHtmlEntities),
    themeColor: meta($, 'theme-color') || meta($, 'msapplication-TileColor'),
    favicon: favicon($, baseUrl),
    manifest: resolveMaybe(attr($, 'link[rel="manifest"]', 'href'), baseUrl),
    ampUrl: resolveMaybe(attr($, 'link[rel="amphtml"]', 'href'), baseUrl),
    alternateLanguages: alternateLanguages($, baseUrl),
    ogUrl,
    ogType: attr($, 'meta[property="og:type"]', 'content'),
    ogTitle: decodeHtmlEntities(attr($, 'meta[property="og:title"]', 'content')),
    ogDescription: decodeHtmlEntities(attr($, 'meta[property="og:description"]', 'content')),
    ogImage,
    siteName: attr($, 'meta[property="og:site_name"]', 'content'),
    twitterCard: meta($, 'twitter:card'),
    twitterSite: meta($, 'twitter:site'),
    twitterCreator: meta($, 'twitter:creator'),
    twitterTitle: decodeHtmlEntities(meta($, 'twitter:title')),
    twitterDescription: decodeHtmlEntities(meta($, 'twitter:description')),
    twitterImage,
    jsonLdTypes: jsonLdTypes($)
  };
}

export function extractJobPosting($: CheerioAPI, baseUrl: string): JobPostingData | null {
  let posting: unknown = null;

  $('script[type="application/ld+json"]').each((_index, element) => {
    if (posting) return;
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    try {
      posting = findJobPosting(JSON.parse(raw));
    } catch {
      // Ignore malformed structured data.
    }
  });

  const postingRecord = asRecord(posting);
  if (!postingRecord) return null;

  const hiringOrganization = asRecord(postingRecord.hiringOrganization);
  const organizationLogo = asRecord(hiringOrganization?.logo);
  const jobLocations = Array.isArray(postingRecord.jobLocation)
    ? postingRecord.jobLocation
    : postingRecord.jobLocation ? [postingRecord.jobLocation] : [];
  const result: JobPostingData = {
    title: firstString(postingRecord.name, postingRecord.title),
    description: cleanDescription(postingRecord.description),
    employmentType: stringValue(postingRecord.employmentType),
    datePosted: stringValue(postingRecord.datePosted),
    validThrough: stringValue(postingRecord.validThrough),
    hiringOrganization: organizationValue(hiringOrganization, organizationLogo, baseUrl),
    jobLocation: uniqueStrings(jobLocations.flatMap((location) => formatLocation(location))),
    baseSalary: formatSalary(postingRecord.baseSalary),
    applicationUrl: resolveJobUrl(asRecord(postingRecord.apply)?.url || postingRecord.url, baseUrl)
  };

  removeEmptyJobPostingFields(result);
  return result;
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findJobPosting(item);
      if (match) return match;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;
  const type = record['@type'];
  if ((typeof type === 'string' && type === 'JobPosting') || (Array.isArray(type) && type.includes('JobPosting'))) {
    return record;
  }
  return findJobPosting(record['@graph']);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]) {
  return values.map(stringValue).find(Boolean);
}

function cleanDescription(value: unknown) {
  const description = stringValue(value);
  if (!description) return undefined;
  return decodeHtmlEntities(description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function organizationValue(
  organization: Record<string, unknown> | null,
  logo: Record<string, unknown> | null,
  baseUrl: string
) {
  if (!organization) return undefined;
  const result: NonNullable<JobPostingData['hiringOrganization']> = {
    name: stringValue(organization.name),
    url: resolveJobUrl(organization.url || organization.sameAs, baseUrl),
    logo: resolveJobUrl(logo?.url || organization.logo, baseUrl)
  };
  removeEmptyObjectFields(result);
  return Object.keys(result).length > 0 ? result : undefined;
}

function formatLocation(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  const location = asRecord(value);
  if (!location) return [];
  const address = asRecord(location.address);
  if (!address) return [stringValue(location.name)].filter((item): item is string => Boolean(item));
  return [address.addressLocality, address.addressRegion, address.addressCountry]
    .map(stringValue)
    .filter((item): item is string => Boolean(item));
}

function formatSalary(value: unknown) {
  if (typeof value === 'string') return value.trim() || undefined;
  const salary = asRecord(value);
  if (!salary) return undefined;
  const currency = stringValue(salary.currency);
  const amount = asRecord(salary.value);
  const salaryValue = amount
    ? [amount.minValue, amount.maxValue].filter((item) => item !== undefined).join('-')
    : stringValue(salary.value);
  if (!salaryValue) return undefined;
  return [currency, salaryValue].filter(Boolean).join(' ');
}

function resolveJobUrl(value: unknown, baseUrl: string) {
  const url = stringValue(value);
  if (!url) return undefined;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function removeEmptyObjectFields(value: Record<string, unknown>) {
  for (const [key, item] of Object.entries(value)) {
    if (!item) delete value[key];
  }
}

function removeEmptyJobPostingFields(value: JobPostingData) {
  removeEmptyObjectFields(value as unknown as Record<string, unknown>);
  if (value.hiringOrganization && Object.keys(value.hiringOrganization).length === 0) delete value.hiringOrganization;
  if (value.jobLocation?.length === 0) delete value.jobLocation;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(parseInt(dec, 10)));
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
