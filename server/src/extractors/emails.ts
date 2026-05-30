import * as cheerio from 'cheerio';

const EMAIL_RE = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi;
const MAILTO_RE = /mailto\s*:\s*([^"'<>\s]+)/gi;
const NON_EMAIL_TLDS = new Set([
  'avif',
  'css',
  'gif',
  'jpeg',
  'jpg',
  'js',
  'json',
  'map',
  'png',
  'svg',
  'webp',
  'woff',
  'woff2'
]);
const TELEMETRY_DOMAINS = ['ingest.sentry.io', 'sentry.io'];

export function extractEmails(html: string) {
  const candidates = new Set<string>();
  const searchable = buildSearchableText(html);
  let mailtoMatch: RegExpExecArray | null;

  while ((mailtoMatch = MAILTO_RE.exec(searchable)) !== null) {
    const decoded = decodeURIComponent(mailtoMatch[1] || '');
    const [email] = decoded.split('?');
    if (email) candidates.add(email);
  }

  for (const match of searchable.match(EMAIL_RE) || []) {
    candidates.add(match);
  }

  return [...new Set([...candidates]
    .map((email) => email.trim().toLowerCase())
    .filter(isUsefulEmail))]
    .sort();
}

function buildSearchableText(html: string) {
  const decoded = decodeTextVariants(html);
  const attributes: string[] = [];

  try {
    const $ = cheerio.load(decoded);
    $('a[href], [href], [title], [aria-label], [data-email], [content]').each((_index, element) => {
      for (const attribute of ['href', 'title', 'aria-label', 'data-email', 'content']) {
        const value = $(element).attr(attribute);
        if (value) attributes.push(value);
      }
    });
    $('a[href^="mailto:" i]').each((_index, element) => {
      const href = $(element).attr('href');
      if (href) attributes.push(href.replace(/^mailto\s*:/i, ''));
    });
  } catch {
    // Plain text and script bundles are still scanned below.
  }

  return decodeTextVariants([decoded, ...attributes].join(' '));
}

function decodeTextVariants(value: string) {
  let output = value
    .replace(/\\u([0-9a-f]{4})/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&commat;/gi, '@')
    .replace(/&amp;/gi, '&')
    .replace(/&#64;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&dot;/gi, '.')
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*/gi, '.')
    .replace(/\s*\(\s*dot\s*\)\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.');

  try {
    output = decodeURIComponent(output);
  } catch {
    // Keep the partially decoded text when percent encoding is malformed.
  }

  return output;
}

function isUsefulEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (local.length > 64 || domain.length > 253) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (local.includes('..')) return false;
  if (!/^[a-z0-9._%+-]+$/.test(local)) return false;
  if (!/^[a-z0-9.-]+$/.test(domain)) return false;
  if (domain.includes('..')) return false;
  if (TELEMETRY_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))) return false;

  const tld = labels.at(-1);
  if (!tld || NON_EMAIL_TLDS.has(tld)) return false;

  return true;
}
