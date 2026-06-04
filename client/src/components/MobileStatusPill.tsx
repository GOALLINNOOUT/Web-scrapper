import { Check, Clock3, Hourglass, Pause, ShieldAlert, Square } from 'lucide-react';
import type { CrawlStatus } from '../types.js';

export function MobileStatusPill({ status }: { status: CrawlStatus }) {
  const Icon = status === 'completed'
    ? Check
    : status === 'failed'
      ? ShieldAlert
      : status === 'paused'
        ? Pause
        : status === 'stopped'
          ? Square
          : status === 'running'
            ? Clock3
            : Hourglass;

  const tone = status === 'completed'
    ? 'bg-[var(--success-light)] text-[var(--success)]'
    : status === 'failed'
      ? 'bg-[var(--danger-light)] text-[var(--danger)]'
      : status === 'running'
        ? 'bg-[var(--accent-light)] text-[var(--accent)]'
        : status === 'paused'
          ? 'bg-[var(--warning-light)] text-[var(--warning)]'
          : status === 'stopped'
            ? 'bg-[var(--warning-light)] text-[var(--warning)]'
            : 'bg-[var(--bg-overlay)] text-[var(--text-secondary)]';

  return (
    <span className={`inline-flex max-w-[92px] shrink-0 items-center gap-1 overflow-hidden rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${tone}`}>
      <Icon className="shrink-0" size={11} />
      <span className="truncate">{status === 'running' ? 'Crawling' : status}</span>
    </span>
  );
}
