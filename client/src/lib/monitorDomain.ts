export function normalizeMonitorDomain(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return '';
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  if (parsed.search || parsed.hash || (path && path !== '/')) return '';

  const domain = parsed.hostname.replace(/^www\./, '');
  if (domain.length < 4 || domain.length > 253 || !domain.includes('.') || domain.includes('..')) return '';
  const labels = domain.split('.');
  const valid = labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && /^[a-z]{2,63}$/.test(labels[labels.length - 1] || '');
  return valid ? domain : '';
}
