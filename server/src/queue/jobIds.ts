import crypto from 'node:crypto';

export function crawlPageJobId(crawlId: string, url: string, prefix = 'page') {
  return safeJobId(prefix, crawlId, stableHash(url));
}

export function crawlRefreshJobId(crawlId: string) {
  return safeJobId('refresh', crawlId);
}

function safeJobId(...parts: string[]) {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9_-]/g, '_')).join('_');
}

function stableHash(value: string) {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 32);
}
