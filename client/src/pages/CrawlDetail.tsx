import { ChevronDown } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { CopyButton } from '../components/CopyButton.jsx';
import { CrawlActionButtons } from '../components/CrawlActionButtons.jsx';
import { CrawlDetailPanel } from '../components/CrawlDetailPanel.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { LoadMoreButton } from '../components/LoadMoreButton.jsx';
import { LoadingState } from '../components/LoadingState.jsx';
import { MetadataPreviewButton } from '../components/MetadataPreviewButton.jsx';
import { RetryCrawlButton } from '../components/RetryCrawlButton.jsx';
import { type ClientLiveEvent, useLiveRefresh } from '../hooks/useLiveEvents.js';
import { applyLiveJobPatch, mergeLivePage, parseLiveCrawlJob, parseLiveCrawlPage } from '../lib/liveCrawl.js';
import type { CrawlJob, CrawlPage, CrawlSummary, SocialLinks } from '../types.js';

const PAGE_SIZE = 25;

export function CrawlDetail() {
  const { id } = useParams();
  const location = useLocation();
  const routeState = location.state as { searchResult?: CrawlPage; focus?: 'emails' | 'tech' | 'page' } | null;
  const selectedResult = routeState?.searchResult;
  const selectedFocus = routeState?.focus;
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [summary, setSummary] = useState<CrawlSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [allEmailsOpen, setAllEmailsOpen] = useState(false);
  const [allSocialsOpen, setAllSocialsOpen] = useState(false);
  const [openSocialPlatforms, setOpenSocialPlatforms] = useState<Set<string>>(new Set());

  async function loadCrawl(crawlId: string) {
    const [crawlJob, results, crawlSummary] = await Promise.all([
      api.getCrawl(crawlId),
      api.getCrawlResults(crawlId, { limit: PAGE_SIZE }),
      api.getCrawlSummary(crawlId)
    ]);
    setJob(crawlJob);
    setPages(results.items);
    setSummary(crawlSummary);
    setNextCursor(results.nextCursor);
    setIsLoading(false);
  }

  useEffect(() => {
    if (!id) return undefined;
    const crawlId = id;
    let cancelled = false;

    async function load() {
      const [crawlJob, results, crawlSummary] = await Promise.all([
        api.getCrawl(crawlId),
        api.getCrawlResults(crawlId, { limit: PAGE_SIZE }),
        api.getCrawlSummary(crawlId)
      ]);
      if (cancelled) return;
      setJob(crawlJob);
      setPages(results.items);
      setSummary(crawlSummary);
      setNextCursor(results.nextCursor);
      setIsLoading(false);
    }

    load().catch((error) => {
      console.error(error);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useLiveRefresh((event) => {
    if (!id || (event.crawlId && event.crawlId !== id)) return;
    if (event.type === 'crawl.page' && applyLivePageEvent(event)) return;
    const jobPatch = parseLiveCrawlJob(event);
    if (jobPatch) setJob((current) => current ? applyLiveJobPatch(current, jobPatch) : current);
  }, [id]);

  function applyLivePageEvent(event: ClientLiveEvent) {
    const payload = parseLiveCrawlPage(event);
    if (!payload?.page) return false;

    setPages((current) => mergeLivePage(current, payload.page, PAGE_SIZE));
    setJob((current) => current ? applyLiveJobPatch(current, payload.job) : current);

    setSummary((current) => mergeSummaryPage(current, payload.page));
    setIsLoading(false);
    return true;
  }

  const loadedEmails = useMemo(() => [...new Set(pages.flatMap((page) => page.emails || []))], [pages]);
  const loadedEmailOccurrences = useMemo(() => pages.flatMap((page) => (page.emails || []).map((email) => ({
    value: email.toLowerCase(),
    pageUrl: page.url
  }))), [pages]);
  const loadedSocials = useMemo(() => {
    const platforms = [...new Set(pages.flatMap((page) => Object.keys(page.social || {}) as (keyof SocialLinks)[]))];
    return platforms.map((platform) => ({
      platform,
      links: [...new Set(pages.flatMap((page) => page.social?.[platform] || []))]
    }))
      .filter((group) => group.links.length > 0);
  }, [pages]);
  const loadedSocialOccurrences = useMemo(() => pages.flatMap((page) => Object.entries(page.social || {}).flatMap(([platform, links]) => (
    ((links || []) as string[]).map((link) => ({
      platform,
      value: String(link),
      pageUrl: page.url
    }))
  ))), [pages]);
  const emails = summary?.emails || loadedEmails;
  const socials = summary?.socials || loadedSocials;
  const emailOccurrences = summary?.emailOccurrences || loadedEmailOccurrences;
  const socialOccurrences = summary?.socialOccurrences || loadedSocialOccurrences;
  const rawEmailOccurrences = summary?.counts.rawEmailOccurrences ?? job?.emailsFound ?? emailOccurrences.length;
  const rawSocialOccurrences = summary?.counts.rawSocialOccurrences ?? job?.socialLinksFound ?? socialOccurrences.length;

  useEffect(() => {
    setOpenSocialPlatforms((current) => {
      if (current.size > 0 || socials.length === 0) return current;
      return new Set([String(socials[0].platform)]);
    });
  }, [socials]);

  useEffect(() => {
    if (selectedFocus === 'emails' && selectedResult?.emails.length) {
      setEmailsOpen(true);
      setAllEmailsOpen(true);
    }
  }, [selectedFocus, selectedResult?._id, selectedResult?.emails.length]);

  function toggleSocialPlatform(platform: string) {
    setOpenSocialPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  return (
    <div className="grid gap-6">
      <header>
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Crawl detail</span>
        <h1 className="mt-2 break-words text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">{job?.seedUrl || 'Loading crawl'}</h1>
      </header>

      {isLoading ? <LoadingState title="Loading crawl detail" rows={5} /> : null}

      {!isLoading ? <CrawlDetailPanel job={job} /> : null}

      {!isLoading && job?.status === 'failed' ? (
        <section className="rounded-[26px] border border-red-200 bg-red-50 p-5 shadow-panel">
          <strong className="block text-sm font-extrabold text-red-800">Crawl failed</strong>
          <p className="mt-1 text-sm font-semibold text-red-700">{job.error || 'The website could not be reached.'}</p>
        </section>
      ) : null}

      {!isLoading && job ? (
        <section className="rounded-[26px] border border-[#eaeae6] bg-white p-4 shadow-panel">
          <CrawlActionButtons job={job} onChange={async () => {
            const [crawlJob, results, crawlSummary] = await Promise.all([
              api.getCrawl(job._id),
              api.getCrawlResults(job._id, { limit: PAGE_SIZE }),
              api.getCrawlSummary(job._id)
            ]);
            setJob(crawlJob);
            setPages(results.items);
            setSummary(crawlSummary);
            setNextCursor(results.nextCursor);
          }} />
          {!['queued', 'running', 'paused'].includes(job.status) ? <RetryCrawlButton job={job} onRetry={async (nextJob) => {
            setJob(nextJob);
            setPages([]);
            setSummary(null);
            setNextCursor(null);
          }} /> : null}
        </section>
      ) : null}

      {!isLoading && selectedResult ? (
        <section className="rounded-lg border border-[#bfdbfe] bg-[#f0f5ff] p-4 shadow-panel">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-brand-700">{selectedFocus === 'emails' ? 'Email source' : 'Selected page'}</span>
          <a className="mt-2 block break-words text-sm font-semibold text-brand-800 hover:text-brand-600" href={selectedResult.url} target="_blank" rel="noreferrer">
            {selectedResult.metadata?.title || selectedResult.url}
          </a>
          <p className="mt-1 break-words font-mono text-xs text-[#636360]">{selectedResult.url}</p>
          {selectedResult.emails.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedResult.emails.map((email) => (
                <span className="group/copy inline-flex max-w-full items-center gap-2 rounded-md bg-white py-1.5 pl-3 pr-1.5 text-sm font-semibold text-[#111110]" key={email}>
                  <span className="min-w-0 break-words">{email}</span>
                  <span className="opacity-0 transition group-hover/copy:opacity-100 group-focus-within/copy:opacity-100">
                    <CopyButton value={email} label="Copy email" />
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {!isLoading ? <section className="grid grid-cols-2 gap-5 max-[980px]:grid-cols-1">
        <div className="overflow-hidden rounded-lg border border-[#eaeae6] bg-white shadow-panel">
          <button className="flex w-full items-center justify-between gap-3 p-6 text-left" type="button" onClick={() => setEmailsOpen((value) => !value)}>
            <span>
              <h2 className="text-xl font-extrabold">Emails extracted</h2>
              <small className="mt-1 block text-sm font-semibold text-[#636360]">{emails.length} unique / {rawEmailOccurrences} found</small>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#efefeb] px-3 py-1 text-sm font-extrabold text-[#636360]">
              {emails.length}
              <ChevronDown className={`transition ${emailsOpen ? 'rotate-180' : ''}`} size={16} />
            </span>
          </button>
          {emailsOpen ? (
            <div className="max-h-[360px] overflow-y-auto border-t border-[#eaeae6] p-4">
              <h3 className="mb-3 text-sm font-extrabold uppercase tracking-[0.12em] text-[#636360]">Unique emails</h3>
              <div className="flex flex-wrap gap-2.5">{emails.length === 0 ? <p className="text-sm font-semibold text-[#636360]">No emails found.</p> : emails.map((email) => (
                <span className="group/copy inline-flex max-w-full items-center gap-2 rounded-full bg-[#f5f5f2] py-1.5 pl-4 pr-1.5 text-sm font-semibold text-[#111110] [overflow-wrap:anywhere]" key={email}>
                  <span className="min-w-0">{email}</span>
                  <span className="opacity-0 transition group-hover/copy:opacity-100 group-focus-within/copy:opacity-100">
                    <CopyButton value={email} label="Copy email" />
                  </span>
                </span>
              ))}</div>
              <OccurrenceSection
                open={allEmailsOpen}
                onToggle={() => setAllEmailsOpen((value) => !value)}
                title="Found occurrences"
                count={emailOccurrences.length}
              >
                {emailOccurrences.map((item, index) => (
                  <OccurrenceRow key={`${item.value}-${item.pageUrl}-${index}`} value={item.value} pageUrl={item.pageUrl} active={selectedResult?.url === item.pageUrl} />
                ))}
              </OccurrenceSection>
            </div>
          ) : null}
        </div>
        <div className="overflow-hidden rounded-lg border border-[#eaeae6] bg-white shadow-panel">
          <button className="flex w-full items-center justify-between gap-3 p-6 text-left" type="button" onClick={() => setSocialsOpen((value) => !value)}>
            <span>
              <h2 className="text-xl font-extrabold">Social profiles</h2>
              <small className="mt-1 block text-sm font-semibold text-[#636360]">{socials.reduce((total, group) => total + group.links.length, 0)} unique / {rawSocialOccurrences} found</small>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#efefeb] px-3 py-1 text-sm font-extrabold text-[#636360]">
              {socials.reduce((total, group) => total + group.links.length, 0)}
              <ChevronDown className={`transition ${socialsOpen ? 'rotate-180' : ''}`} size={16} />
            </span>
          </button>
          {socialsOpen ? (
          <div className="grid max-h-[420px] gap-4 overflow-y-auto border-t border-[#eaeae6] p-4">
            <h3 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#636360]">Unique profiles</h3>
            {socials.length === 0 ? <p className="text-sm font-semibold text-[#636360]">No social profiles found.</p> : null}
            {socials.map((group) => (
              <div className="overflow-hidden rounded-lg border border-[#eaeae6] bg-[#f5f5f2]" key={group.platform}>
                <button
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  type="button"
                  onClick={() => toggleSocialPlatform(String(group.platform))}
                >
                  <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">{group.platform}</span>
                  <span className="inline-flex items-center gap-2 text-sm font-extrabold text-[#636360]">
                    {group.links.length}
                    <ChevronDown className={`transition ${openSocialPlatforms.has(String(group.platform)) ? 'rotate-180' : ''}`} size={16} />
                  </span>
                </button>
                {openSocialPlatforms.has(String(group.platform)) ? (
                  <div className="flex flex-wrap gap-2.5 border-t border-[#eaeae6] bg-white p-3">
                    {group.links.map((link) => (
                      <span className="group/copy inline-flex max-w-full items-center gap-2 rounded-full bg-[#ebf2ff] py-1.5 pl-4 pr-1.5 text-sm font-semibold text-brand-800 [overflow-wrap:anywhere]" key={link}>
                        <a className="min-w-0 transition hover:text-brand-600" href={link} target="_blank" rel="noreferrer">{link}</a>
                        <span className="opacity-0 transition group-hover/copy:opacity-100 group-focus-within/copy:opacity-100">
                          <CopyButton value={link} label={`Copy ${group.platform} link`} />
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <OccurrenceSection
              open={allSocialsOpen}
              onToggle={() => setAllSocialsOpen((value) => !value)}
              title="Found occurrences"
              count={socialOccurrences.length}
            >
              {socialOccurrences.map((item, index) => (
                <OccurrenceRow key={`${item.platform}-${item.value}-${item.pageUrl}-${index}`} value={`${item.platform}: ${item.value}`} copyValue={item.value} pageUrl={item.pageUrl} />
              ))}
            </OccurrenceSection>
          </div>
          ) : null}
        </div>
      </section> : null}

      {!isLoading ? <DataTable
        rows={pages}
        columns={[
          {
            key: 'url',
            label: 'URL',
            render: (page) => (
              <span className="group/copy inline-flex max-w-full items-center gap-2">
                <a className="min-w-0 truncate font-semibold text-brand-800 hover:text-brand-600" href={page.url} target="_blank" rel="noreferrer">{page.url}</a>
                <span className="opacity-0 transition group-hover/copy:opacity-100 group-focus-within/copy:opacity-100">
                  <CopyButton value={page.url} label="Copy link" />
                </span>
                <MetadataPreviewButton url={page.url} />
              </span>
            )
          },
          { key: 'title', label: 'Title', render: (page) => page.metadata?.title || 'Untitled' },
          { key: 'depth', label: 'Depth' },
          { key: 'emails', label: 'Emails', render: (page) => page.emails?.length || 0 },
          { key: 'links', label: 'Links', render: (page) => page.links?.length || 0 }
        ]}
      /> : null}
      {!isLoading ? <LoadMoreButton hasMore={Boolean(nextCursor)} isLoading={isLoadingMore} onClick={async () => {
        if (!id || !nextCursor) return;
        setIsLoadingMore(true);
        try {
          const nextPage = await api.getCrawlResults(id, { limit: PAGE_SIZE, cursor: nextCursor });
          setPages((current) => [...current, ...nextPage.items]);
          setNextCursor(nextPage.nextCursor);
        } finally {
          setIsLoadingMore(false);
        }
      }} /> : null}
    </div>
  );
}

function OccurrenceSection({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-[#eaeae6] bg-white">
      <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" type="button" onClick={onToggle}>
        <span className="text-sm font-extrabold">{title}</span>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#efefeb] px-2.5 py-1 text-xs font-extrabold text-[#636360]">
          {count}
          <ChevronDown className={`transition ${open ? 'rotate-180' : ''}`} size={14} />
        </span>
      </button>
      {open ? <div className="grid max-h-[260px] gap-2 overflow-y-auto border-t border-[#eaeae6] p-3">{children}</div> : null}
    </div>
  );
}

function OccurrenceRow({ value, copyValue = value, pageUrl, active = false }: { value: string; copyValue?: string; pageUrl: string; active?: boolean }) {
  return (
    <div className={`grid gap-1 rounded-md p-3 text-sm ${active ? 'border border-[#bfdbfe] bg-[#f0f5ff]' : 'bg-[#f5f5f2]'}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 break-words font-bold text-[#111110]">{value}</span>
        <CopyButton value={copyValue} label="Copy value" />
      </div>
      {pageUrl ? <a className="truncate text-xs font-semibold text-brand-700 hover:text-brand-600" href={pageUrl} target="_blank" rel="noreferrer">Found on {pageUrl}</a> : null}
    </div>
  );
}

function mergeSummaryPage(summary: CrawlSummary | null, page: CrawlPage) {
  if (!summary) return summary;

  const pageEmails = [...new Set((page.emails || []).map((email) => email.toLowerCase()))];
  const emailOccurrences = [
    ...summary.emailOccurrences,
    ...pageEmails.map((value) => ({ value, pageUrl: page.url }))
  ];
  const emails = [...new Set([...summary.emails, ...pageEmails])].sort();

  const socialOccurrences = [
    ...summary.socialOccurrences,
    ...Object.entries(page.social || {}).flatMap(([platform, links]) => (
      ((links || []) as string[]).map((value) => ({ platform, value, pageUrl: page.url }))
    ))
  ];
  const socialMap = new Map<string, Set<string>>();
  for (const group of summary.socials) socialMap.set(String(group.platform), new Set(group.links));
  for (const item of socialOccurrences) {
    const current = socialMap.get(String(item.platform)) || new Set<string>();
    current.add(item.value);
    socialMap.set(String(item.platform), current);
  }

  return {
    ...summary,
    pagesCrawled: Math.max(summary.pagesCrawled, summary.counts.loadedPages + 1),
    emails,
    emailOccurrences,
    socials: [...socialMap.entries()].map(([platform, links]) => ({ platform, links: [...links] })),
    socialOccurrences,
    techStack: [...new Set([...summary.techStack, ...(page.techStack || [])])].sort(),
    counts: {
      ...summary.counts,
      uniqueEmails: emails.length,
      uniqueSocialProfiles: [...new Set(socialOccurrences.map((item) => item.value))].length,
      uniqueTech: [...new Set([...summary.techStack, ...(page.techStack || [])])].length,
      loadedPages: summary.counts.loadedPages + 1,
      rawEmailOccurrences: summary.counts.rawEmailOccurrences + pageEmails.length,
      rawSocialOccurrences: summary.counts.rawSocialOccurrences + socialOccurrences.filter((item) => item.pageUrl === page.url).length
    }
  };
}
