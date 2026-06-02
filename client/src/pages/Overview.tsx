import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ExternalLink, Globe2, LinkIcon, LoaderCircle, Mail, Radar, Search, Share2, Sparkles, Tags } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CrawlActionButtons } from '../components/CrawlActionButtons.jsx';
import { CrawlStatusBadge } from '../components/CrawlStatusBadge.jsx';
import { LoadingState } from '../components/LoadingState.jsx';
import { RetryCrawlButton } from '../components/RetryCrawlButton.jsx';
import { useLiveRefresh } from '../hooks/useLiveEvents.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { mergeLivePage, parseLiveCrawlJob, parseLiveCrawlJobSnapshot, parseLiveCrawlPage, patchJobList, upsertJobList } from '../lib/liveCrawl.js';
import { normalizeSeedUrl } from '../lib/seedUrl.js';
import { showToast } from '../toast.js';
import type { CrawlConfig, CrawlJob, CrawlPage } from '../types.js';
import { MobileOverview } from './MobileOverview.jsx';

const DEFAULT_CRAWL_CONFIG: Omit<CrawlConfig, 'seedUrl'> = {
  maxPages: 100,
  maxDepth: 3,
  concurrency: 5,
  sameDomainOnly: true,
  respectRobots: false,
  discovery: {
    sitemap: true,
    renderJavaScript: true,
    renderWhenStaticLinksBelow: 20,
    includeMetaLinks: true
  },
  extract: {
    links: true,
    emails: true,
    metadata: true,
    social: true
  }
};

export function Overview() {
  const isMobile = useMediaQuery('(max-width: 899px)');
  return isMobile ? <MobileOverview /> : <DesktopOverview />;
}

function DesktopOverview() {
  const lastFailureToastId = useRef<string | null>(null);
  const initializedFailureToast = useRef(false);
  const [seedUrl, setSeedUrl] = useState('');
  const [config, setConfig] = useState(DEFAULT_CRAWL_CONFIG);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);

  async function load() {
    const [crawlJobs, data, settings] = await Promise.all([
      api.listCrawls(),
      api.getData({ limit: 25 }),
      api.getSettings().catch(() => null)
    ]);
    setJobs(crawlJobs);
    setPages(data.items);
    if (settings) {
      setConfig((current) => ({
        ...current,
        maxPages: settings.crawling.maxPages,
        maxDepth: settings.crawling.defaultDepth,
        respectRobots: settings.crawling.respectRobots
      }));
    }
    setIsLoading(false);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useLiveRefresh((event) => {
    const payload = parseLiveCrawlPage(event);
    if (payload) {
      setJobs((current) => patchJobList(current, event.crawlId, payload.job));
      setPages((current) => mergeLivePage(current, payload.page, 25));
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

  useEffect(() => {
    const latestFailed = jobs.find((job) => job.status === 'failed');
    if (!latestFailed) return;

    if (!initializedFailureToast.current) {
      initializedFailureToast.current = true;
      lastFailureToastId.current = latestFailed._id;
      return;
    }

    if (lastFailureToastId.current === latestFailed._id) return;
    lastFailureToastId.current = latestFailed._id;

    showToast({
      title: 'Crawl failed',
      description: latestFailed.error || 'The crawler could not fetch this URL.',
      tone: 'error'
    });
  }, [jobs]);

  async function startCrawl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedSeedUrl = normalizeSeedUrl(seedUrl);
    if (!normalizedSeedUrl) {
      showToast({
        title: 'Invalid crawl target',
        description: 'Enter a valid website, for example example.com or https://example.com',
        tone: 'error'
      });
      return;
    }

    setIsStarting(true);
    try {
      const job = await api.createCrawl({ ...config, seedUrl: normalizedSeedUrl });
      setSeedUrl('');
      showToast({ title: 'Crawl started', description: normalizedSeedUrl, tone: 'success' });
      setJobs((current) => [job, ...current]);
    } finally {
      setIsStarting(false);
    }
  }

  const todayJobs = useMemo(() => jobs.filter((job) => isToday(job.createdAt)), [jobs]);
  const activeJobs = todayJobs.filter((job) => ['queued', 'running', 'paused'].includes(job.status));
  const latestJob = activeJobs[0] || todayJobs[0] || null;
  const todayPages = useMemo(() => pages.filter((page) => isToday(page.crawledAt)), [pages]);
  const todayMetrics = useMemo(() => {
    const emails = todayPages.reduce((total, page) => total + page.emails.length, 0);
    const socials = new Set(todayPages.flatMap((page) => Object.values(page.social || {}).flat())).size;
    return { pages: todayPages.length, emails, socials };
  }, [todayPages]);
  const progress = latestJob ? getProgress(latestJob) : 0;
  const activityFeed = useMemo(() => buildActivityFeed(jobs, pages), [jobs, pages]);
  const highlights = useMemo(() => buildHighlights(pages), [pages]);

  return (
    <div className="command-page grid gap-6">
      <header className="grid gap-6 rounded-lg bg-gradient-to-br from-[#f0f5ff] to-white p-6 shadow-panel">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Overview</span>
            <h1 className="command-heading mt-2 text-[44px] font-extrabold leading-tight max-[900px]:text-3xl">Web intelligence command center</h1>
            <p className="mt-2.5 max-w-3xl text-[17px] leading-7 text-[#636360]">Start crawls, watch discoveries stream in, and focus on the signals that deserve attention.</p>
          </div>
          <div className="min-w-[260px] rounded-lg border border-[#eaeae6] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">Right now</span>
              <span className={`h-2.5 w-2.5 rounded-full ${activeJobs.length ? 'live-dot bg-[#16a34a]' : 'bg-[#c8c8c2]'}`} />
            </div>
            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <strong className="block font-mono text-4xl font-semibold leading-none text-[#111110]">{activeJobs.length}</strong>
                <span className="mt-2 block text-sm font-semibold text-[#636360]">active crawl{activeJobs.length === 1 ? '' : 's'}</span>
              </div>
              <div className="rounded-md bg-[#f5f5f2] px-3 py-2 text-right">
                <strong className="block font-mono text-lg font-semibold text-[#111110]">{pages.length}</strong>
                <small className="block text-xs font-semibold text-[#636360]">recent pages</small>
              </div>
            </div>
          </div>
        </div>

        <form className="grid gap-3" onSubmit={startCrawl}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 rounded-full border border-[#c8c8c2] bg-white p-2 shadow-[0_18px_45px_rgba(11,15,13,0.08)] max-[860px]:grid-cols-1 max-[860px]:rounded-lg">
            <label className="flex min-h-14 min-w-0 items-center gap-3 px-4">
              <Search className="shrink-0 text-brand-700" size={22} />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold outline-none placeholder:text-[#9b9b97]"
                value={seedUrl}
                onChange={(event) => setSeedUrl(event.target.value)}
                placeholder="example.com or https://example.com"
                inputMode="url"
                autoComplete="url"
              />
            </label>
            <button className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-[#c8c8c2] bg-white px-5 font-extrabold text-brand-800 transition hover:bg-[#efefeb]" type="button" onClick={() => setShowAdvanced((value) => !value)}>
              <Tags size={18} />
              Config
              <ChevronDown className={`transition ${showAdvanced ? 'rotate-180' : ''}`} size={16} />
            </button>
            <button className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-brand-600 px-7 font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70" type="submit" disabled={isStarting}>
              {isStarting ? <LoaderCircle className="animate-spin" size={18} /> : <Radar size={18} />}
              {isStarting ? 'Starting' : 'Start crawl'}
            </button>
          </div>

          {showAdvanced ? (
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-[#eaeae6] bg-white p-4 shadow-panel max-[1000px]:grid-cols-2 max-[640px]:grid-cols-1">
              <RangeControl label="Max pages" value={config.maxPages} min={1} max={1000} onChange={(value) => setConfig((current) => ({ ...current, maxPages: value }))} />
              <RangeControl label="Max depth" value={config.maxDepth} min={0} max={10} onChange={(value) => setConfig((current) => ({ ...current, maxDepth: value }))} />
              <RangeControl label="Concurrency" value={config.concurrency} min={1} max={10} onChange={(value) => setConfig((current) => ({ ...current, concurrency: value }))} />
              <RangeControl label="Render below links" value={config.discovery.renderWhenStaticLinksBelow} min={0} max={100} onChange={(value) => setConfig((current) => ({ ...current, discovery: { ...current.discovery, renderWhenStaticLinksBelow: value } }))} />
              <ToggleControl label="Same domain only" checked={config.sameDomainOnly} onChange={(value) => setConfig((current) => ({ ...current, sameDomainOnly: value }))} />
              <ToggleControl label="Respect robots.txt" checked={Boolean(config.respectRobots)} onChange={(value) => setConfig((current) => ({ ...current, respectRobots: value }))} />
              <ToggleControl label="Sitemap discovery" checked={config.discovery.sitemap} onChange={(value) => setConfig((current) => ({ ...current, discovery: { ...current.discovery, sitemap: value } }))} />
              <ToggleControl label="Render JavaScript" checked={config.discovery.renderJavaScript} onChange={(value) => setConfig((current) => ({ ...current, discovery: { ...current.discovery, renderJavaScript: value } }))} />
              <ToggleControl label="Page hint links" checked={config.discovery.includeMetaLinks} onChange={(value) => setConfig((current) => ({ ...current, discovery: { ...current.discovery, includeMetaLinks: value } }))} />
              <ToggleControl label="Extract links" icon={LinkIcon} checked={config.extract.links} onChange={(value) => setConfig((current) => ({ ...current, extract: { ...current.extract, links: value } }))} />
              <ToggleControl label="Extract emails" icon={Mail} checked={config.extract.emails} onChange={(value) => setConfig((current) => ({ ...current, extract: { ...current.extract, emails: value } }))} />
              <ToggleControl label="Extract metadata" icon={Tags} checked={config.extract.metadata} onChange={(value) => setConfig((current) => ({ ...current, extract: { ...current.extract, metadata: value } }))} />
              <ToggleControl label="Extract socials" icon={Share2} checked={config.extract.social} onChange={(value) => setConfig((current) => ({ ...current, extract: { ...current.extract, social: value } }))} />
            </div>
          ) : null}
        </form>
      </header>

      {isLoading ? <LoadingState title="Loading today's workspace" /> : null}

      {!isLoading ? (
        <>
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] gap-5 max-[1100px]:grid-cols-1">
          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold">Operational focus</h2>
                <p className="mt-1 text-sm font-semibold text-[#636360]">Latest crawl state and next best inspection path.</p>
              </div>
              {latestJob ? <CrawlStatusBadge status={latestJob.status} /> : null}
            </div>

            {!latestJob ? (
              <div className="grid min-h-52 place-items-center rounded-lg bg-[#f5f5f2] p-8 text-center">
                <div>
                  <Globe2 className="mx-auto text-brand-600" size={34} />
                  <h3 className="mt-4 text-xl font-extrabold">No crawl started today</h3>
                  <p className="mt-2 text-sm font-semibold text-[#636360]">Enter a competitor, lead, or monitored website above to create the first intelligence stream.</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-5">
                <div className="min-w-0">
                  <p className="truncate text-lg font-extrabold">{latestJob.seedUrl}</p>
                  <p className="mt-1 text-sm font-semibold text-[#636360]">{getProgressText(latestJob)}</p>
                </div>
                {latestJob.status === 'failed' ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <strong className="block text-sm font-extrabold text-red-800">Crawl failed</strong>
                    <p className="mt-1 text-sm font-semibold text-red-700">{latestJob.error || 'The crawler could not fetch this URL.'}</p>
                  </div>
                ) : null}
                <div>
                  <div className="mb-2 flex justify-between text-sm font-extrabold text-[#636360]">
                    <span>{latestJob.status === 'running' ? 'Page limit used' : 'Progress'}</span>
                    <span>{latestJob.status === 'completed' ? '100% complete' : `${progress}%`}</span>
                  </div>
                  <div className="h-4 overflow-hidden rounded-full bg-[#e8e8e4]">
                    <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 max-[640px]:grid-cols-1">
                  <MetricPill icon={Globe2} label="Pages" value={latestJob.pagesCrawled} />
                  <MetricPill icon={Mail} label="Emails" value={latestJob.emailsFound} />
                  <MetricPill icon={Share2} label="Socials" value={latestJob.socialLinksFound} />
                </div>
                {['queued', 'running', 'paused'].includes(latestJob.status) ? <CrawlActionButtons job={latestJob} onChange={load} /> : null}
                {!['queued', 'running', 'paused'].includes(latestJob.status) ? <RetryCrawlButton job={latestJob} onRetry={load} /> : null}
                {latestJob.status !== 'failed' ? <div className="flex flex-wrap gap-3">
                  <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 font-extrabold text-white transition hover:bg-brand-700" to={`/crawls/${latestJob._id}`}>
                    Open crawl report <ArrowRight size={16} />
                  </Link>
                  <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#c8c8c2] bg-white px-5 font-extrabold text-brand-800 transition hover:bg-[#efefeb]" to="/data">
                    Browse data archive <ArrowRight size={16} />
                  </Link>
                </div> : null}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold">Live intelligence feed</h2>
                <p className="mt-1 text-sm font-semibold text-[#636360]">Recent discoveries translated into readable events.</p>
              </div>
              <Link className="inline-flex items-center gap-1 rounded-full bg-[#efefeb] px-3 py-2 text-sm font-extrabold text-brand-800 transition hover:bg-[#ebf2ff]" to="/data">
                Data <ArrowRight size={15} />
              </Link>
            </div>
            <div className="grid gap-3">
              {activityFeed.map((item) => {
                const Icon = item.icon;
                const isSelected = selectedActivityId === item.id;
                const sourceUrl = item.detail.startsWith('http') ? item.detail : '';
                return (
                  <article className={`overflow-hidden rounded-lg bg-[#f5f5f2] transition ${isSelected ? 'ring-1 ring-[#bfdbfe]' : 'hover:bg-[#efefeb]'}`} key={item.id}>
                    <button
                      className="grid w-full grid-cols-[38px_minmax(0,1fr)_auto] items-start gap-3 p-3 text-left"
                      type="button"
                      onClick={() => setSelectedActivityId((current) => current === item.id ? null : item.id)}
                    >
                      <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Icon size={16} /></span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{item.title}</strong>
                        <small className="mt-0.5 block truncate text-xs font-semibold text-[#636360]">{item.detail}</small>
                      </span>
                      <ChevronDown className={`mt-2 text-[#636360] transition ${isSelected ? 'rotate-180' : ''}`} size={16} />
                    </button>
                    {isSelected ? (
                      <div className="grid gap-3 border-t border-[#eaeae6] bg-white p-3">
                        <p className="break-words font-mono text-xs text-[#636360]">{item.detail}</p>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-extrabold text-white transition hover:bg-brand-700"
                            to={item.page ? `/crawls/${item.page.crawlId}?page=${encodeURIComponent(item.page._id)}` : item.to}
                            state={item.page ? { searchResult: item.page, focus: item.page.emails.length ? 'emails' : item.page.techStack?.length ? 'tech' : 'page' } : undefined}
                          >
                            Open crawl <ArrowRight size={14} />
                          </Link>
                          {sourceUrl ? (
                            <a className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#c8c8c2] bg-white px-3 text-xs font-extrabold text-brand-800 transition hover:bg-[#f5f5f2]" href={sourceUrl} target="_blank" rel="noreferrer">
                              Open source <ExternalLink size={14} />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {activityFeed.length === 0 ? <p className="rounded-lg bg-[#f5f5f2] p-4 text-sm font-semibold text-[#636360]">Start a crawl to generate a live stream of discovered pages, contacts, and technology signals.</p> : null}
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-extrabold">Intelligence highlights</h2>
              <p className="mt-1 text-sm font-semibold text-[#636360]">Pages and domains with the clearest signal density.</p>
            </div>
            <Sparkles className="text-brand-600" size={22} />
          </div>
          <div className="grid grid-cols-3 gap-3 max-[900px]:grid-cols-1">
            {highlights.map((item) => (
              <Link className="rounded-lg bg-[#f5f5f2] p-4 transition hover:bg-[#efefeb]" key={item.id} to={`/crawls/${item.crawlId}`}>
                <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">{item.kicker}</span>
                <strong className="mt-2 block truncate text-lg">{item.title}</strong>
                <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#636360]">{item.detail}</p>
              </Link>
            ))}
            {highlights.length === 0 ? <p className="rounded-lg bg-[#f5f5f2] p-4 text-sm font-semibold text-[#636360]">Once pages are crawled, high-signal findings will appear here first.</p> : null}
          </div>
        </section>
        </>
      ) : null}
    </div>
  );
}

function RangeControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4">
      <span className="flex items-center justify-between text-sm font-bold text-[#636360]">{label} <strong className="text-[#111110]">{value}</strong></span>
      <input className="accent-brand-600" type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ToggleControl({ label, checked, onChange, icon: Icon }: { label: string; checked: boolean; onChange: (value: boolean) => void; icon?: typeof Globe2 }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-[#f5f5f2] p-4">
      <span className="inline-flex items-center gap-2 text-sm font-bold text-[#636360]">{Icon ? <Icon size={15} /> : null}{label}</span>
      <input className="h-5 w-5 accent-brand-600" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function MetricPill({ icon: Icon, label, value }: { icon: typeof Globe2; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#f5f5f2] p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-[#636360]"><Icon size={15} /> {label}</div>
      <strong className="mt-2 block text-3xl font-extrabold">{value}</strong>
    </div>
  );
}

function buildActivityFeed(jobs: CrawlJob[], pages: CrawlPage[]) {
  const jobEvents = jobs.slice(0, 4).map((job) => ({
    id: `job-${job._id}`,
    icon: Radar,
    title: `${job.status[0].toUpperCase()}${job.status.slice(1)} crawl: ${toDomain(job.seedUrl)}`,
    detail: `${job.pagesCrawled} pages, ${job.emailsFound} emails, ${job.socialLinksFound} social profiles`,
    to: `/crawls/${job._id}`,
    page: undefined,
    date: new Date(job.updatedAt).getTime()
  }));

  const pageEvents = pages.slice(0, 6).map((page) => ({
    id: `page-${page._id}`,
    icon: page.emails.length ? Mail : page.techStack?.length ? Tags : Globe2,
    title: page.emails.length
      ? `${page.emails.length} email${page.emails.length === 1 ? '' : 's'} found on ${page.domain || 'page'}`
      : page.techStack?.length
        ? `${page.techStack.slice(0, 2).join(', ')} detected`
        : `Page discovered: ${page.metadata?.title || page.domain || 'Untitled page'}`,
    detail: page.url,
    to: `/crawls/${page.crawlId}`,
    page,
    date: new Date(page.crawledAt).getTime()
  }));

  return [...jobEvents, ...pageEvents]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);
}

function buildHighlights(pages: CrawlPage[]) {
  return pages
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3)
    .map((page) => ({
      id: page._id,
      crawlId: page.crawlId,
      kicker: `${page.score || 0}/100 intelligence score`,
      title: page.metadata?.title || page.domain || page.url,
      detail: [
        page.classification?.pageType ? `${page.classification.pageType} page` : null,
        page.emails.length ? `${page.emails.length} emails` : null,
        page.techStack?.length ? `${page.techStack.slice(0, 3).join(', ')}` : null
      ].filter(Boolean).join(' - ') || page.url
    }));
}

function toDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0] || value;
  }
}

function isToday(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function getProgress(job: CrawlJob) {
  if (job.status === 'completed') return 100;
  if (job.status === 'failed') return 0;
  return Math.min(100, Math.round((job.pagesCrawled / Math.max(1, job.config.maxPages)) * 100));
}

function getProgressText(job: CrawlJob) {
  if (job.status === 'completed') return `${job.pagesCrawled} pages crawled - ${job.config.maxPages} page limit`;
  if (job.status === 'stopped') return `Stopped at ${job.pagesCrawled} pages - ${job.config.maxPages} page limit`;
  if (job.status === 'failed') return 'Crawl failed before completion';
  return `${job.pagesCrawled} of ${job.config.maxPages} page limit used`;
}
