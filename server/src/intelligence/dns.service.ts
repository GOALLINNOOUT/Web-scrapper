import dns from 'node:dns/promises';

export async function lookupDns(domain: string) {
  const [mxRecords, aRecords, txtRecords] = await Promise.all([
    dns.resolveMx(domain).catch(() => []),
    dns.resolve4(domain).catch(() => []),
    dns.resolveTxt(domain).catch(() => [])
  ]);

  return {
    mxRecords,
    aRecords,
    txtRecords,
    mailProviderGuess: guessMailProvider(mxRecords.map((record) => record.exchange).join(' '))
  };
}

export function guessMailProvider(value: string) {
  const haystack = value.toLowerCase();
  if (haystack.includes('google.com') || haystack.includes('googlemail.com')) return 'Google Workspace';
  if (haystack.includes('outlook.com') || haystack.includes('protection.outlook.com')) return 'Microsoft 365';
  if (haystack.includes('zoho.com')) return 'Zoho';
  if (haystack.includes('protonmail') || haystack.includes('proton.me')) return 'Proton';
  return 'Unknown';
}
