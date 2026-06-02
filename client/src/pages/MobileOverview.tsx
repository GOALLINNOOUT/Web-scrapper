import { ArrowRight, Clock3, Globe2, Plus, SearchX, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { MobileStatusPill } from '../components/MobileStatusPill.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { useLiveRefresh } from '../hooks/useLiveEvents.js';
import { mergeLivePage, parseLiveCrawlJob, parseLiveCrawlJobSnapshot, parseLiveCrawlPage, patchJobList, upsertJobList } from '../lib/liveCrawl.js';
import type { CrawlJob, CrawlPage, MonitoringSummary } from '../types.js';

const activeStatuses = ['queued', 'running', 'paused'] as const;

export function MobileOverview() {
  const navigate = useNavigate();
  const metricRowRef = useRef<HTMLDivElement>(null);
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [activeMetric, setActiveMetric] = useState(0);

  async function load() {
    setLoadError(null);
    try {
      const [crawlJobs, data, monitoringSummary] = await Promise.all([
        api.listCrawls(),
        api.getData({ limit: 100 }),
        api.getMonitoring().catch(() => null)
      ]);
      setJobs(crawlJobs);
      setPages(data.items);
      setMonitoring(monitoringSummary);
    } catch (error) {
      setLoadError(error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);

    function handleCreated(event: Event) {
      const job = (event as CustomEvent<CrawlJob>).detail;
      setJobs((current) => upsertJobList(current, job));
      setIsLoading(false);
    }

    window.addEventListener('web-intel-mobile-crawl-created', handleCreated);
    return () => window.removeEventListener('web-intel-mobile-crawl-created', handleCreated);
  }, []);

  useLiveRefresh((event) => {
    const payload = parseLiveCrawlPage(event);
    if (payload) {
      setJobs((current) => {
        const patched = patchJobList(current, event.crawlId, payload.job);
        if (event.crawlId && !patched.some((job) => job._id === event.crawlId)) {
          void api.getCrawl(event.crawlId)
            .then((job) => setJobs((latest) => upsertJobList(latest, job)))
            .catch(() => undefined);
        }
        return patched;
      });
      setPages((current) => mergeLivePage(current, payload.page, 100));
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

  const allKnownJobs = useMemo(() => mergeJobs(jobs, monitoring?.activeCrawls || []), [jobs, monitoring?.activeCrawls]);
  const activeCrawls = useMemo(() => allKnownJobs.filter((job) => activeStatuses.includes(job.status as typeof activeStatuses[number])).slice(0, 8), [allKnownJobs]);
  const metrics = useMemo(() => {
    const pagesCrawled = allKnownJobs.reduce((total, job) => total + (job.pagesCrawled || 0), 0);
    const emailsFound = allKnownJobs.reduce((total, job) => total + (job.emailsFound || 0), 0);
    const monitoredDomains = monitoring?.health.monitoredDomains || monitoring?.profiles.length || monitoring?.domains.length || 0;
    const changesDetected = monitoring?.counts.changesToday || monitoring?.changeFeed.length || 0;
    const pageTrend = trendFromWindows(
      pages,
      (page) => page.crawledAt,
      (page) => 1
    );
    const emailTrend = trendFromWindows(
      pages,
      (page) => page.crawledAt,
      (page) => page.emails.length
    );
    const domainTrend = trendFromWindows(
      monitoring?.profiles || [],
      (profile) => profile.createdAt,
      () => 1
    );
    const changeTrend = trendFromWindows(
      monitoring?.changeFeed || [],
      (event) => event.detectedAt,
      () => 1
    );

    return [
      { label: 'Pages Crawled', value: pagesCrawled, ...pageTrend },
      { label: 'Emails Found', value: emailsFound, ...emailTrend },
      { label: 'Domains Monitored', value: monitoredDomains, ...domainTrend },
      { label: 'Changes Detected', value: changesDetected, ...changeTrend }
    ];
  }, [allKnownJobs, monitoring, pages]);

  function handleMetricScroll() {
    const row = metricRowRef.current;
    if (!row) return;
    window.requestAnimationFrame(() => {
      const card = row.querySelector<HTMLElement>('[data-metric-card]');
      const width = (card?.offsetWidth || 148) + 12;
      setActiveMetric(Math.max(0, Math.min(3, Math.round(row.scrollLeft / width))));
    });
  }

  return (
    <div className="mobile-page-enter pb-[112px]">
      {!isLoading && loadError ? <div className="px-5 pt-4"><ErrorState error={loadError} title="Could not load Overview" onRetry={() => { setIsLoading(true); return load(); }} /></div> : null}
      {!loadError ? (
      <>
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="mobile-section-label">Metrics</h2>
        <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-5" ref={metricRowRef} onScroll={handleMetricScroll}>
          {metrics.map((metric, index) => (
            <MetricCard key={metric.label} metric={metric} index={index} loading={isLoading} />
          ))}
        </div>
        <div className="mt-3 flex justify-center gap-[5px]" aria-hidden="true">
          {metrics.map((metric, index) => (
            <span className={`h-[5px] rounded-full transition-all duration-200 ease-[var(--quart)] ${activeMetric === index ? 'w-3.5 bg-[var(--accent)]' : 'w-[5px] bg-[var(--border-default)]'}`} key={metric.label} />
          ))}
        </div>
      </section>

      <section className="mt-[18px]" aria-labelledby="active-crawls-heading">
        <h2 id="active-crawls-heading" className="mobile-section-label">Active Crawls</h2>
        <div className="px-5">
          {isLoading ? (
            <div className="grid gap-2.5">
              {[0, 1, 2].map((item) => <CrawlSkeleton key={item} />)}
            </div>
          ) : null}

          {!isLoading && activeCrawls.length === 0 ? <EmptyState jobs={allKnownJobs} onBrowse={() => navigate('/data')} /> : null}

          {!isLoading ? activeCrawls.map((job, index) => (
            <button
              aria-label={`Open crawl for ${toDomain(job.seedUrl)}`}
              className="mobile-crawl-card mobile-tap w-full text-left"
              key={job._id}
              style={{ animationDelay: `${Math.min(400, 80 + index * 50)}ms` }}
              type="button"
              onClick={() => navigate(`/crawls/${job._id}`)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Favicon url={job.seedUrl} />
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{toDomain(job.seedUrl)}</span>
                </span>
                <MobileStatusPill status={job.status} />
              </div>

              <div className="mt-3">
                <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-sunken)]">
                  <span
                    className={`mobile-progress-fill block h-full rounded-full ${job.status === 'completed' ? 'bg-[var(--success)]' : 'bg-[var(--accent)]'} ${job.status === 'running' ? 'mobile-progress-live' : ''}`}
                    style={{ width: `${progressFor(job)}%` }}
                  />
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-[var(--text-secondary)]">{job.pagesCrawled} / {job.config.maxPages} pages · {job.emailsFound} emails</span>
                <span className="font-mono text-[11px] font-medium text-[var(--text-tertiary)]">{progressFor(job)}%</span>
              </div>
            </button>
          )) : null}
        </div>
      </section>
      </>
      ) : null}
    </div>
  );
}

function MetricCard({ metric, index, loading }: { metric: { label: string; value: number; trend: string; tone: 'positive' | 'negative' | 'neutral' }; index: number; loading: boolean }) {
  const Icon = metric.tone === 'positive' ? TrendingUp : metric.tone === 'negative' ? TrendingDown : Clock3;
  const toneClass = metric.tone === 'positive'
    ? 'bg-[var(--success-light)] text-[var(--success)]'
    : metric.tone === 'negative'
      ? 'bg-[var(--danger-light)] text-[var(--danger)]'
      : 'bg-[var(--bg-raised)] text-[var(--text-tertiary)]';

  return (
    <article
      className="mobile-metric-card mobile-tap"
      data-metric-card
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{metric.label}</span>
      {loading ? (
        <span className="mobile-skeleton mt-3 block h-9 w-24 rounded-md" />
      ) : (
        <CountUp className="mt-2 block font-mono text-[28px] font-semibold leading-none text-[var(--text-primary)]" value={metric.value} />
      )}
      <span className={`mt-3 inline-flex items-center gap-1 rounded-full px-[7px] py-0.5 text-[11px] font-semibold ${toneClass}`}>
        <Icon size={11} />
        {metric.trend}
      </span>
    </article>
  );
}

function trendFromWindows<T>(items: T[], getDate: (item: T) => string | undefined | null, getValue: (item: T) => number) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  let current = 0;
  let previous = 0;

  for (const item of items) {
    const time = new Date(getDate(item) || '').getTime();
    if (!Number.isFinite(time)) continue;
    const value = getValue(item);
    if (time >= now - day) current += value;
    else if (time >= now - day * 2) previous += value;
  }

  if (current === 0 && previous === 0) return { trend: 'No recent data', tone: 'neutral' as const };
  if (previous === 0) return { trend: current > 0 ? `+${current}` : '0', tone: current > 0 ? 'positive' as const : 'neutral' as const };
  const delta = current - previous;
  const percent = Math.round((delta / Math.max(1, previous)) * 100);
  if (percent === 0) return { trend: '0%', tone: 'neutral' as const };
  return { trend: `${percent > 0 ? '+' : ''}${percent}%`, tone: percent > 0 ? 'positive' as const : 'negative' as const };
}

function mergeJobs(primary: CrawlJob[], secondary: CrawlJob[]) {
  const byId = new Map<string, CrawlJob>();
  for (const job of [...secondary, ...primary]) {
    const existing = byId.get(job._id);
    byId.set(job._id, existing ? { ...existing, ...job } : job);
  }
  return [...byId.values()].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function CountUp({ value, className }: { value: number; className: string }) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    const start = performance.now();
    const from = hasMountedRef.current ? displayRef.current : 0;
    const delta = value - from;
    hasMountedRef.current = true;
    let frame = 0;

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - progress, 4);
      const next = Math.round(from + delta * eased);
      displayRef.current = next;
      setDisplay(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
      else displayRef.current = value;
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return <strong className={className}>{display.toLocaleString()}</strong>;
}

function CrawlSkeleton() {
  return (
    <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
      <span className="mobile-skeleton block h-5 w-40 rounded-md" />
      <span className="mobile-skeleton mt-4 block h-1 rounded-full" />
      <span className="mobile-skeleton mt-3 block h-4 w-56 rounded-md" />
    </div>
  );
}

function EmptyState({ jobs, onBrowse }: { jobs: CrawlJob[]; onBrowse: () => void }) {
  const recent = jobs.slice(0, 3);

  return (
    <div className="mobile-empty-state rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-light)] text-[var(--accent)]">
          <SearchX size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">No active crawls</p>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">{recent.length ? 'Everything is idle right now. Review recent crawl results or start a fresh run.' : 'Start a crawl to populate live progress and discoveries here.'}</p>
        </div>
      </div>

      {recent.length ? (
        <div className="mt-4 grid gap-2">
          {recent.map((job) => (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-raised)] px-3 py-2" key={job._id}>
              <span className="min-w-0 truncate text-xs font-semibold text-[var(--text-primary)]">{toDomain(job.seedUrl)}</span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">{job.pagesCrawled}p</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="mobile-tap inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-white" type="button" onClick={() => window.dispatchEvent(new Event('web-intel-open-new-crawl'))}>
          <Plus size={16} />
          Start
        </button>
        <button className="mobile-tap inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--bg-raised)] px-3 text-sm font-semibold text-[var(--accent)]" type="button" onClick={onBrowse}>
          Data
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function Favicon({ url }: { url: string }) {
  const domain = toDomain(url);
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded bg-[var(--accent-light)] text-[10px] font-semibold uppercase text-[var(--accent)]">
      {domain.slice(0, 1)}
    </span>
  );
}

function progressFor(job: CrawlJob) {
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
