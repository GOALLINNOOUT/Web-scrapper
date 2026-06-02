import type { CrawlStatus } from '../types.js';

interface CrawlStatusBadgeProps {
  status?: CrawlStatus;
}

export function CrawlStatusBadge({ status }: CrawlStatusBadgeProps) {
  const currentStatus = status || 'queued';
  const tones: Record<string, string> = {
    running: 'bg-sky-100 text-sky-800',
    paused: 'bg-violet-100 text-violet-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    interrupted: 'bg-orange-100 text-orange-800',
    stopped: 'bg-amber-100 text-amber-800',
    queued: 'bg-zinc-100 text-zinc-700'
  };

  return <span className={`inline-flex w-fit max-w-full truncate rounded-full px-2.5 py-1 text-xs font-extrabold capitalize ${tones[currentStatus]}`}>{currentStatus}</span>;
}
