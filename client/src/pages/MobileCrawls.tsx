import { Activity, Eye, Mail, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorState } from '../components/ErrorState.jsx';
import { MobileStatusPill } from '../components/MobileStatusPill.jsx';
import { useLiveRefresh } from '../hooks/useLiveEvents.js';
import { formatRelativeTime, progressFor, toDomain } from '../lib/format.js';
import { parseLiveCrawlJob, parseLiveCrawlJobSnapshot, parseLiveCrawlPage, patchJobList, upsertJobList } from '../lib/liveCrawl.js';
import type { CrawlJob } from '../types.js';

export function MobileCrawls() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  async function load() {
    try {
      setLoadError(null);
      setJobs(await api.listCrawls());
    } catch (error) {
      setLoadError(error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useLiveRefresh((event) => {
    const payload = parseLiveCrawlPage(event);
    if (payload) {
      setJobs((current) => patchJobList(current, event.crawlId, payload.job));
      setIsLoading(false);
      return;
    }
    const jobPatch = parseLiveCrawlJob(event);
    if (jobPatch) {
      const snapshot = parseLiveCrawlJobSnapshot(event);
      setJobs((current) => snapshot ? upsertJobList(current, snapshot) : patchJobList(current, event.crawlId, jobPatch));
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="mobile-page-enter mx-auto w-full max-w-[400px] px-4 pb-[112px] pt-2">
      <h2 className="mobile-section-label !px-0">Operations</h2>
      {isLoading ? <div className="grid gap-2">{[0, 1, 2].map((item) => <span className="mobile-skeleton h-28 rounded-xl" key={item} />)}</div> : null}
      {!isLoading && loadError ? <ErrorState error={loadError} title="Could not load crawls" onRetry={() => { setIsLoading(true); return load(); }} /> : null}
      {!isLoading && !loadError && jobs.length === 0 ? <div className="rounded-xl bg-[var(--bg-base)] p-8 text-center"><Activity className="mx-auto text-[var(--accent)]" size={34} /><p className="mt-3 text-sm font-semibold">No crawl operations yet</p></div> : null}
      <div className="grid gap-2">
        {!loadError && jobs.map((job) => {
          const progress = progressFor(job);
          return (
            <button className="mobile-crawl-card mobile-tap w-full text-left" key={job._id} type="button" onClick={() => navigate(`/crawls/${job._id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{toDomain(job.seedUrl)}</strong>
                  <span className="mt-1 block truncate font-mono text-[11px] text-[var(--text-secondary)]">{job.seedUrl}</span>
                </div>
                <MobileStatusPill status={job.status} />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-sunken)]"><span className={`mobile-progress-fill block h-full rounded-full ${job.status === 'completed' ? 'bg-[var(--success)]' : 'bg-[var(--accent)]'} ${job.status === 'running' ? 'mobile-progress-live' : ''}`} style={{ width: `${progress}%` }} /></div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="flex gap-2 text-[11px] font-semibold text-[var(--text-secondary)]"><Mail size={13} /> {job.emailsFound}<Share2 size={13} /> {job.socialLinksFound}</span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--text-tertiary)]"><Eye size={13} /> {progress}% · {formatRelativeTime(job.updatedAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
