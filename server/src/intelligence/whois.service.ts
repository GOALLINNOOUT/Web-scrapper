import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const whois = require('whois') as {
  lookup: (domain: string, options: { timeout: number }, callback: (error: Error | null, data?: unknown) => void) => void;
};

export async function lookupWhois(domain: string) {
  const raw = await new Promise<string>((resolve, reject) => {
    whois.lookup(domain, { timeout: 10_000 }, (error, data) => {
      if (error) reject(error);
      else resolve(String(data || ''));
    });
  });

  return {
    registrar: firstMatch(raw, /Registrar:\s*(.+)/i),
    creationDate: parseDate(firstMatch(raw, /Creation Date:\s*(.+)|Created On:\s*(.+)|Registered On:\s*(.+)/i)),
    expiryDate: parseDate(firstMatch(raw, /Registry Expiry Date:\s*(.+)|Expiry Date:\s*(.+)|Expiration Date:\s*(.+)/i)),
    updatedDate: parseDate(firstMatch(raw, /Updated Date:\s*(.+)/i)),
    registrantCountry: firstMatch(raw, /Registrant Country:\s*(.+)/i),
    nameServers: [...raw.matchAll(/Name Server:\s*(.+)/gi)].map((match) => match[1].trim().toLowerCase())
  };
}

function firstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  if (!match) return undefined;
  return (match.slice(1).find(Boolean) || '').trim();
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
