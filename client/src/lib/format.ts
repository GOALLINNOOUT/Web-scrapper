export function toDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0] || value;
  }
}

export function formatDate(value?: string | null) {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function formatRelativeTime(value?: string | null) {
  if (!value) return 'Unknown';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function progressFor(job: { status: string; pagesCrawled: number; config: { maxPages: number } }) {
  if (job.status === 'completed') return 100;
  if (job.status === 'failed') return 0;
  return Math.min(100, Math.round((job.pagesCrawled / Math.max(1, job.config.maxPages)) * 100));
}

export function displayTechStack(values?: string[] | null) {
  const unique = [...new Set((values || []).filter(Boolean))];
  if (unique.includes('Next.js')) return unique.filter((value) => value !== 'React');
  return unique;
}
