import { Activity, Eye, Mail, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CrawlActionButtons } from '../components/CrawlActionButtons.jsx';
import { CrawlStatusBadge } from '../components/CrawlStatusBadge.jsx';
import { LoadingState } from '../components/LoadingState.jsx';
import { useLiveRefresh } from '../hooks/useLiveEvents.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { parseLiveCrawlJob, parseLiveCrawlJobSnapshot, parseLiveCrawlPage, patchJobList, upsertJobList } from '../lib/liveCrawl.js';
import type { CrawlJob } from '../types.js';
import { MobileCrawls } from './MobileCrawls.jsx';

export function Crawls() {
  const isMobile = useMediaQuery('(max-width: 899px)');
  if (isMobile) return <MobileCrawls />;
  return <DesktopCrawls />;
}

function DesktopCrawls() {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    try {
      setJobs(await api.listCrawls());
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
    <div className="desktop-page grid gap-6">
      <header className="flex items-end justify-between gap-4 max-[720px]:grid">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Crawls</span>
          <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Crawl operations</h1>
          <p className="mt-2 text-[16px] text-[#636360]">Progress, discoveries, and controls for every active intelligence job.</p>
        </div>
      </header>
      {isLoading ? <LoadingState title="Loading crawl jobs" /> : (
        <section className="desktop-card overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] shadow-panel">
          <div className="grid grid-cols-[minmax(260px,1.4fr)_120px_160px_110px_170px_220px] gap-4 border-b border-[#eaeae6] px-5 py-4 text-xs font-extrabold uppercase tracking-[0.12em] text-[#636360] max-[1100px]:hidden">
            <span>Target</span>
            <span>Status</span>
            <span>Progress</span>
            <span>Depth</span>
            <span>Signals</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-[#eaeae6]">
            {jobs.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <Activity className="mx-auto text-brand-600" size={32} />
                <h2 className="mt-4 text-xl font-extrabold">No crawl operations yet</h2>
                <p className="mt-2 text-sm font-semibold text-[#636360]">Start from Overview to create the first monitored intelligence job.</p>
              </div>
            ) : null}
            {jobs.map((job) => (
              <article className="grid grid-cols-[minmax(260px,1.4fr)_120px_160px_110px_170px_220px] items-center gap-4 px-5 py-4 transition hover:bg-white/70 max-[1100px]:grid-cols-1" key={job._id}>
                <div className="flex min-w-0 items-center gap-3">
                  <img className="h-9 w-9 rounded-full bg-[#efefeb]" src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(job.seedUrl)}`} alt="" />
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">{toDomain(job.seedUrl)}</strong>
                    <span className="block truncate text-xs font-semibold text-[#636360]">{job.seedUrl}</span>
                  </div>
                </div>
                <CrawlStatusBadge status={job.status} />
                <div>
                  <div className="mb-1 flex justify-between text-xs font-extrabold text-[#636360]"><span>{getProgress(job)}%</span><span>{job.pagesCrawled}/{job.config.maxPages}</span></div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#e8e8e4]"><div className="h-full rounded-full bg-brand-600" style={{ width: `${getProgress(job)}%` }} /></div>
                </div>
                <span className="text-sm font-bold text-[#636360]">{job.config?.maxDepth}</span>
                <div className="flex flex-wrap gap-2 text-xs font-extrabold text-[#636360]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#efefeb] px-2.5 py-1"><Mail size={13} /> {job.emailsFound}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#efefeb] px-2.5 py-1"><Share2 size={13} /> {job.socialLinksFound}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="grid h-10 w-10 place-items-center rounded-full border border-[#c8c8c2] bg-white text-[#636360] transition hover:border-brand-300 hover:text-brand-800" to={`/crawls/${job._id}`} title="View crawl"><Eye size={16} /></Link>
                  <CrawlActionButtons job={job} onChange={load} compact />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function getProgress(job: CrawlJob) {
  if (job.status === 'completed') return 100;
  if (job.status === 'failed') return 0;
  return Math.min(100, Math.round((job.pagesCrawled / Math.max(1, job.config.maxPages)) * 100));
}

function toDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0] || value;
  }
}
