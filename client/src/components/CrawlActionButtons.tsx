import { LoaderCircle, Pause, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.js';
import { useActionLock } from '../lib/actionLocks.js';
import { showToast } from '../toast.js';
import type { CrawlJob } from '../types.js';

interface CrawlActionButtonsProps {
  job: CrawlJob;
  onChange: () => Promise<void> | void;
  compact?: boolean;
}

type Action = 'pause' | 'continue' | 'stop';

export function CrawlActionButtons({ job, onChange, compact = false }: CrawlActionButtonsProps) {
  const [loadingAction, setLoadingAction] = useState<Action | null>(null);
  const { isLocked, runLocked } = useActionLock(`crawl:${job._id}`);

  async function run(action: Action) {
    await runLocked(async () => {
      setLoadingAction(action);
      try {
        if (action === 'pause') await api.pauseCrawl(job._id);
        if (action === 'continue') await api.continueCrawl(job._id);
        if (action === 'stop') await api.stopCrawl(job._id);
        await onChange();
        showToast({
          title: action === 'continue' ? 'Crawl continued' : `Crawl ${action}d`,
          description: job.seedUrl,
          tone: 'success'
        });
      } finally {
        setLoadingAction(null);
      }
    });
  }

  const isBusy = isLocked || loadingAction !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {job.status === 'running' ? (
        <button className={`${compact ? 'min-h-9 px-3 text-xs' : 'min-h-10 px-4 text-sm'} inline-flex items-center gap-2 rounded-full border border-[#c8c8c2] bg-white font-extrabold text-[#636360] transition hover:border-brand-300 hover:text-brand-800 disabled:cursor-wait disabled:opacity-60`} onClick={() => run('pause')} disabled={isBusy} title="Pause crawl">
          {loadingAction === 'pause' ? <LoaderCircle className="animate-spin" size={15} /> : <Pause size={15} />}
          <span>Pause</span>
        </button>
      ) : null}
      {job.status === 'paused' ? (
        <button className={`${compact ? 'min-h-9 px-3 text-xs' : 'min-h-10 px-4 text-sm'} inline-flex items-center gap-2 rounded-full bg-brand-600 font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60`} onClick={() => run('continue')} disabled={isBusy} title="Continue crawl">
          {loadingAction === 'continue' ? <LoaderCircle className="animate-spin" size={15} /> : <Play size={15} />}
          <span>Continue</span>
        </button>
      ) : null}
      {['queued', 'running', 'paused'].includes(job.status) ? (
        <button className={`${compact ? 'min-h-9 px-3 text-xs' : 'min-h-10 px-4 text-sm'} inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 font-extrabold text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60`} onClick={() => run('stop')} disabled={isBusy} title="Stop crawl">
          {loadingAction === 'stop' ? <LoaderCircle className="animate-spin" size={15} /> : <Square size={15} />}
          <span>Stop</span>
        </button>
      ) : null}
    </div>
  );
}
