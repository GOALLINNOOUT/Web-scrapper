import dns from 'node:dns/promises';
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';

export async function ssrfProtection(req: Request, res: Response, next: NextFunction) {
  const candidate = String(req.body?.seedUrl || req.body?.url || req.body?.domain || '');
  if (!candidate) return next();

  const blocked = await isPrivateUrl(candidate);
  if (blocked) {
    return res.status(400).json({
      error: 'SSRF_BLOCKED',
      message: 'Private, local, or unresolvable crawl targets are not allowed.'
    });
  }

  next();
}

export async function isPrivateUrl(value: string) {
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    if (parsed.username || parsed.password) return true;
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    if (![80, 443].includes(port)) return true;
    if (isPrivateHost(parsed.hostname)) return true;

    const addresses = await dns.lookup(parsed.hostname, { all: true });
    return addresses.some(({ address }) => isPrivateHost(address));
  } catch {
    return true;
  }
}

export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0' || host === 'broadcasthost') return true;
  if (host === 'metadata.google.internal' || host === '169.254.169.254' || host === '100.100.100.200') return true;
  if (net.isIP(host) === 6) {
    const normalized = host.toLowerCase();
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('64:ff9b:1:')
      || normalized.startsWith('100::')
      || normalized.startsWith('2002:')
      || normalized.startsWith('::ffff:0:')
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.')
      || normalized.startsWith('::ffff:169.254.');
  }

  if (net.isIP(host) === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    return a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0)
      || (a === 192 && b === 88)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51)
      || (a === 203 && b === 0)
      || a >= 224;
  }

  return false;
}
