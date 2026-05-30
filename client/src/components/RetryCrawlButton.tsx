import { LoaderCircle, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.js';
import { useActionLock } from '../lib/actionLocks.js';
import { showToast } from '../toast.js';
import type { CrawlConfig, CrawlJob } from '../types.js';

interface RetryCrawlButtonProps {
  job: CrawlJob;
  onRetry?: (job: CrawlJob) => Promise<void> | void;
  compact?: boolean;
}

export function RetryCrawlButton({ job, onRetry, compact = false }: RetryCrawlButtonProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const { isLocked, runLocked } = useActionLock(`crawl:${job._id}`);

  async function retry() {
    await runLocked(async () => {
      setIsRetrying(true);
      try {
        const nextJob = await api.createCrawl(toRetryConfig(job));
        showToast({ title: 'Crawl restarted', description: nextJob.seedUrl, tone: 'success' });
        await onRetry?.(nextJob);
      } finally {
        setIsRetrying(false);
      }
    });
  }

  return (
    <button
      className={`${compact ? 'min-h-9 px-3 text-xs' : 'min-h-11 px-5 text-sm'} inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70`}
      type="button"
      onClick={retry}
      disabled={isRetrying || isLocked}
      title="Retry crawl"
    >
      {isRetrying ? <LoaderCircle className="animate-spin" size={15} /> : <RotateCcw size={15} />}
      {isRetrying ? 'Retrying' : 'Retry crawl'}
    </button>
  );
}

function toRetryConfig(job: CrawlJob): CrawlConfig {
  return {
    ...job.config,
    seedUrl: job.config?.seedUrl || job.seedUrl
  };
}
