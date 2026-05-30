const INVALID_PROTOCOLS = new Set(['mailto:', 'tel:', 'javascript:', 'data:', 'blob:', 'file:']);
const NON_PAGE_EXTENSIONS = new Set([
  '7z',
  'aac',
  'avi',
  'avif',
  'bmp',
  'css',
  'csv',
  'doc',
  'docx',
  'eot',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'js',
  'json',
  'map',
  'mjs',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'otf',
  'pdf',
  'png',
  'rar',
  'svg',
  'tar',
  'ttf',
  'txt',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
  'xls',
  'xlsx',
  'xml',
  'zip'
]);

const PRIVATE_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./
];

export function normalizeUrl(rawUrl?: string | null, baseUrl?: string) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const trimmed = rawUrl.trim();
    const candidate = baseUrl || hasUrlScheme(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate, baseUrl);
    if (INVALID_PROTOCOLS.has(parsed.protocol)) return null;
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null;

    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function hasUrlScheme(value: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(value);
}

export function isSameDomain(url: string, seedUrl: string) {
  try {
    return comparableHost(new URL(url).hostname) === comparableHost(new URL(seedUrl).hostname);
  } catch {
    return false;
  }
}

function comparableHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function isLikelyPageUrl(url: string) {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').pop() || '';
    const extension = segment.includes('.') ? segment.split('.').pop()?.toLowerCase() : '';
    return !extension || !NON_PAGE_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host)) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true;
  return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(host));
}

export function assertPublicHttpUrl(url: string) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs can be crawled');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Private or local network URLs cannot be crawled');
  }
}
