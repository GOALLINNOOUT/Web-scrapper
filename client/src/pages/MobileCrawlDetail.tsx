import { Globe2, Info, Mail, Share2, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { CopyButton } from '../components/CopyButton.jsx';
import { useLiveRefresh } from '../hooks/useLiveEvents.js';
import { formatRelativeTime, progressFor, toDomain } from '../lib/format.js';
import { applyLiveJobPatch, mergeLivePage, parseLiveCrawlJob, parseLiveCrawlPage } from '../lib/liveCrawl.js';
import { showToast } from '../toast.js';
import type { CrawlJob, CrawlPage } from '../types.js';

const PAGE_SIZE = 25;
type SignalTab = 'emails' | 'social' | 'metadata';

export function MobileCrawlDetail() {
  const { id } = useParams();
  const location = useLocation();
  const selectedPageRef = useRef<HTMLElement>(null);
  const routeState = location.state as { searchResult?: CrawlPage; focus?: 'emails' | 'tech' | 'page' } | null;
  const selectedPageId = new URLSearchParams(location.search).get('page');
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<CrawlPage | null>(routeState?.searchResult || null);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [signalTab, setSignalTab] = useState<SignalTab>(() => routeState?.focus === 'emails' ? 'emails' : 'metadata');
  const [metadataPage, setMetadataPage] = useState<CrawlPage | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setIsLoading(true);
    Promise.all([api.getCrawl(id), api.getCrawlResults(id, { limit: PAGE_SIZE })])
      .then(([crawlJob, results]) => {
        if (!cancelled) {
          setJob(crawlJob);
          const selectedFromResults = selectedPageId ? results.items.find((page) => page._id === selectedPageId) : null;
          const selectedFromState = routeState?.searchResult && routeState.searchResult.crawlId === id ? routeState.searchResult : null;
          const nextSelected = selectedFromResults || selectedFromState;
          setSelectedPage(nextSelected || null);
          setPages(nextSelected && !results.items.some((page) => page._id === nextSelected._id) ? [nextSelected, ...results.items] : results.items);
          setNextCursor(results.nextCursor);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, selectedPageId, routeState?.searchResult?._id]);

  useEffect(() => {
    if (!id || !selectedPageId || selectedPage || isLoading) return;
    let cancelled = false;

    api.getData({ q: selectedPageId, limit: 10 })
      .then((data) => {
        if (cancelled) return;
        const match = data.items.find((page) => page._id === selectedPageId && page.crawlId === id);
        if (match) {
          setSelectedPage(match);
          setPages((current) => current.some((page) => page._id === match._id) ? current : [match, ...current]);
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [id, selectedPageId, selectedPage, isLoading]);

  useEffect(() => {
    if (!selectedPage || !selectedPageRef.current) return;
    window.setTimeout(() => selectedPageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [selectedPage?._id]);

  useLiveRefresh((event) => {
    if (!id || (event.crawlId && event.crawlId !== id)) return;
    const pagePayload = parseLiveCrawlPage(event);
    if (pagePayload) {
      setPages((current) => mergeLivePage(current, pagePayload.page, PAGE_SIZE));
      setJob((current) => current ? applyLiveJobPatch(current, pagePayload.job) : current);
      return;
    }
    const jobPatch = parseLiveCrawlJob(event);
    if (jobPatch) setJob((current) => current ? applyLiveJobPatch(current, jobPatch) : current);
  }, [id]);

  const uniqueEmails = useMemo(() => new Set(pages.flatMap((page) => page.emails)).size, [pages]);
  const tech = useMemo(() => [...new Set(pages.flatMap((page) => page.techStack || []))], [pages]);
  const signalEmailData = useMemo(() => buildEmailEvidence(selectedPage ? [selectedPage] : pages), [pages, selectedPage]);
  const signalSocialGroups = useMemo(() => buildSocialGroups(selectedPage ? [selectedPage] : pages), [pages, selectedPage]);
  const metadataRows = useMemo(() => selectedPage ? buildMetadataRows(selectedPage) : [], [selectedPage]);

  async function loadMore() {
    if (!id || !nextCursor) return;
    setIsLoadingMore(true);
    try {
      const data = await api.getCrawlResults(id, { limit: PAGE_SIZE, cursor: nextCursor });
      setPages((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (isLoading || !job) return <div className="px-4"><div className="grid gap-2">{[0, 1, 2].map((item) => <span className="mobile-skeleton h-24 rounded-xl" key={item} />)}</div></div>;

  const progress = progressFor(job);

  return (
    <div className="mobile-page-enter px-4 pb-6">
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">Crawl Detail</span>
        <h2 className="mt-2 break-words text-xl font-semibold">{toDomain(job.seedUrl)}</h2>
        <p className="mt-1 break-words font-mono text-[11px] text-[var(--text-secondary)]">{job.seedUrl}</p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-sunken)]"><span className={`mobile-progress-fill block h-full rounded-full ${job.status === 'completed' ? 'bg-[var(--success)]' : 'bg-[var(--accent)]'} ${job.status === 'running' ? 'mobile-progress-live' : ''}`} style={{ width: `${progress}%` }} /></div>
        <div className="mt-2 flex justify-between font-mono text-[11px] text-[var(--text-secondary)]"><span>{job.pagesCrawled} of {job.config.maxPages}</span><span>{progress}%</span></div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Mini icon={Globe2} label="Pages" value={job.pagesCrawled} />
        <Mini icon={Mail} label="Emails" value={uniqueEmails || job.emailsFound} />
        <Mini icon={Share2} label="Socials" value={job.socialLinksFound} />
        <Mini icon={Zap} label="Tech" value={tech.length} />
      </div>

      {tech.length ? <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">{tech.map((item) => <span className="shrink-0 rounded-full bg-[var(--accent-light)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]" key={item}>{item}</span>)}</div> : null}

      {selectedPage ? (
        <section className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--border-subtle))] bg-[var(--accent-light)] p-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--accent)]">{routeState?.focus === 'emails' ? 'Email source' : 'Selected page'}</span>
          <h3 className="mt-2 truncate text-base font-semibold text-[var(--text-primary)]">{selectedPage.metadata?.title || toDomain(selectedPage.url)}</h3>
          <p className="mobile-text-clamp mt-1 font-mono text-[11px] text-[var(--text-secondary)]">{selectedPage.url}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            <span>{selectedPage.emails.length} emails</span>
            <span>{selectedPage.links.length} links</span>
            <span>{selectedPage.techStack?.length || 0} tech</span>
          </div>
          {selectedPage.emails.length ? (
            <div className="mt-3 grid gap-2">
              {selectedPage.emails.slice(0, 4).map((email) => <span className="mobile-text-clamp rounded-xl bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px]" key={email}>{email}</span>)}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Signals</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{selectedPage ? 'Viewing selected page evidence.' : 'Viewing loaded crawl evidence. Select a page to inspect metadata.'}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 rounded-xl bg-[var(--bg-raised)] p-1">
          {([
            ['emails', `Emails ${signalEmailData.unique.length}`],
            ['social', `Social ${signalSocialGroups.reduce((total, group) => total + group.unique.length, 0)}`],
            ['metadata', 'Metadata']
          ] as Array<[SignalTab, string]>).map(([tab, label]) => (
            <button
              aria-pressed={signalTab === tab}
              className={`h-9 rounded-lg text-[12px] font-semibold transition ${signalTab === tab ? 'bg-[var(--bg-base)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}
              key={tab}
              type="button"
              onClick={() => setSignalTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        {signalTab === 'emails' ? <EmailSignals evidence={signalEmailData} /> : null}
        {signalTab === 'social' ? <SocialSignals groups={signalSocialGroups} /> : null}
        {signalTab === 'metadata' ? <MetadataSignals rows={metadataRows} hasSelectedPage={Boolean(selectedPage)} /> : null}
      </section>

      <h2 className="mobile-section-label !px-0">Pages</h2>
      <div className="grid gap-2">
        {pages.map((page) => (
          <article
            className={`mobile-archive-card mobile-crawl-card block ${selectedPageId === page._id ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-canvas)]' : ''}`}
            key={page._id}
            ref={selectedPageId === page._id ? selectedPageRef : undefined}
          >
            <strong className="block truncate text-sm">{page.metadata?.title || toDomain(page.url)}</strong>
            <span className="mobile-text-clamp mt-1 block font-mono text-[11px] text-[var(--text-secondary)]">{page.url}</span>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--text-secondary)]"><span>{page.emails.length} emails</span><span>{page.links.length} links</span><span>{formatRelativeTime(page.crawledAt)}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a className="mobile-open-action" href={page.url} target="_blank" rel="noreferrer">Open</a>
              <button className="mobile-open-action" type="button" onClick={() => setMetadataPage(page)}><Info size={14} /> Metadata</button>
            </div>
          </article>
        ))}
      </div>
      {nextCursor ? <button className="mt-4 h-11 w-full rounded-xl bg-[var(--bg-base)] text-sm font-semibold text-[var(--accent)]" type="button" onClick={loadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Loading...' : 'Load more pages'}</button> : null}
      <MetadataSheet page={metadataPage} onClose={() => setMetadataPage(null)} />
    </div>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof Globe2; label: string; value: number }) {
  return <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"><div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]"><span>{label}</span><Icon size={16} /></div><strong className="mt-3 block font-mono text-2xl">{value}</strong></div>;
}

function EmailSignals({ evidence }: { evidence: EmailEvidence }) {
  return (
    <div className="mt-4 grid gap-2">
      <SignalCounts unique={evidence.unique.length} found={evidence.found.length} />
      {evidence.unique.length > 1 ? <CopyAllButton label="Copy all emails" values={evidence.unique} /> : null}
      {evidence.unique.length === 0 ? <EmptySignal text="No emails found in the current evidence." /> : null}
      {evidence.unique.map((email) => (
        <div className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-xl bg-[var(--bg-raised)] px-3 py-2" key={email}>
          <span className="mobile-text-clamp font-mono text-xs font-semibold text-[var(--text-primary)]">{email}</span>
          <CopyButton value={email} label="Copy email" />
        </div>
      ))}
      {evidence.found.length > evidence.unique.length ? (
        <details className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-raised)]">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--accent)]">Found occurrences</summary>
          <div className="grid gap-2 border-t border-[var(--border-subtle)] p-2">
            {evidence.found.map((item, index) => (
              <div className="rounded-lg bg-[var(--bg-base)] p-2" key={`${item.value}-${item.pageUrl}-${index}`}>
                <div className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2">
                  <span className="mobile-text-clamp font-mono text-[11px] font-semibold">{item.value}</span>
                  <CopyButton value={item.value} label="Copy email" />
                </div>
                <span className="mobile-text-clamp mt-1 block text-[10px] text-[var(--text-secondary)]">{item.pageUrl}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SocialSignals({ groups }: { groups: SocialGroup[] }) {
  return (
    <div className="mt-4 grid gap-2">
      <SignalCounts unique={groups.reduce((total, group) => total + group.unique.length, 0)} found={groups.reduce((total, group) => total + group.found.length, 0)} />
      {groups.length === 0 ? <EmptySignal text="No social profiles found in the current evidence." /> : null}
      {groups.map((group, index) => (
        <details className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-raised)]" key={group.platform} open={index === 0}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--accent)]">
            {group.platform} - {group.unique.length} unique / {group.found.length} found
          </summary>
          <div className="grid gap-2 border-t border-[var(--border-subtle)] p-2">
            {group.unique.length > 1 ? <CopyAllButton label={`Copy all ${group.platform}`} values={group.unique} /> : null}
            {group.unique.map((value) => (
              <div className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-lg bg-[var(--bg-base)] p-2" key={value}>
                <a className="mobile-text-clamp font-mono text-[11px] font-semibold text-[var(--text-primary)]" href={value} target="_blank" rel="noreferrer">{value}</a>
                <CopyButton value={value} label={`Copy ${group.platform} link`} />
              </div>
            ))}
            {group.found.length > group.unique.length ? (
              <details className="rounded-lg bg-[var(--bg-base)]">
                <summary className="cursor-pointer px-2 py-2 text-[11px] font-semibold text-[var(--accent)]">Found occurrences</summary>
                <div className="grid gap-2 border-t border-[var(--border-subtle)] p-2">
                  {group.found.map((item, index) => (
                    <div className="rounded-md bg-[var(--bg-raised)] p-2" key={`${item.value}-${item.pageUrl}-${index}`}>
                      <div className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2">
                        <a className="mobile-text-clamp font-mono text-[11px] font-semibold" href={item.value} target="_blank" rel="noreferrer">{item.value}</a>
                        <CopyButton value={item.value} label={`Copy ${group.platform} link`} />
                      </div>
                      <span className="mobile-text-clamp mt-1 block text-[10px] text-[var(--text-secondary)]">{item.pageUrl}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

function MetadataSignals({ rows, hasSelectedPage }: { rows: Array<[string, string]>; hasSelectedPage: boolean }) {
  if (!hasSelectedPage) return <div className="mt-4"><EmptySignal text="Metadata is page-specific. Open a page from search, Explorer, or the page list to view its metadata here." /></div>;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      {rows.length === 0 ? <EmptySignal text="No metadata was captured for this page." /> : null}
      {rows.map(([label, value]) => (
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2.5 last:border-b-0" key={label}>
          <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{label}</span>
          <strong className="min-w-0 break-words text-[11px] font-semibold text-[var(--text-primary)]">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function MetadataSheet({ page, onClose }: { page: CrawlPage | null; onClose: () => void }) {
  if (!page) return null;
  const rows = buildMetadataRows(page);

  return createPortal(
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-labelledby="page-metadata-title">
      <button className="mobile-sheet-overlay absolute inset-0 w-full" type="button" aria-label="Close metadata" onClick={onClose} />
      <section className="mobile-sheet-panel absolute bottom-0 left-0 right-0 h-[78vh]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
          <span className="mx-auto block h-1 w-9 rounded-full bg-[var(--border-default)]" />
          <button className="mobile-icon-btn absolute right-4 top-3" type="button" aria-label="Close metadata" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="no-scrollbar h-[calc(78vh-53px)] overflow-y-auto px-5 pb-8 pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">Page metadata</span>
          <h2 id="page-metadata-title" className="mt-2 truncate text-xl font-semibold">{page.metadata?.title || toDomain(page.url)}</h2>
          <p className="mobile-text-clamp mt-1 font-mono text-[11px] text-[var(--text-secondary)]">{page.url}</p>
          {rows.length === 0 ? <div className="mt-4"><EmptySignal text="No metadata was captured for this page." /></div> : null}
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
            {rows.map(([label, value]) => (
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2.5 last:border-b-0" key={label}>
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{label}</span>
                <strong className="min-w-0 break-words text-[11px] font-semibold text-[var(--text-primary)]">{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function EmptySignal({ text }: { text: string }) {
  return <p className="rounded-xl bg-[var(--bg-raised)] p-4 text-sm font-medium text-[var(--text-secondary)]">{text}</p>;
}

function SignalCounts({ unique, found }: { unique: number; found: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-[var(--bg-raised)] p-3"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Unique</span><strong className="mt-1 block font-mono text-lg">{unique}</strong></div>
      <div className="rounded-xl bg-[var(--bg-raised)] p-3"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Found</span><strong className="mt-1 block font-mono text-lg">{found}</strong></div>
    </div>
  );
}

function CopyAllButton({ label, values }: { label: string; values: string[] }) {
  return (
    <button className="mobile-open-action" type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(values.join('\n'));
        showToast({ title: 'Copied', description: `${values.length} item${values.length === 1 ? '' : 's'}`, tone: 'success' });
      } catch {
        showToast({ title: 'Copy failed', description: 'Clipboard access was not available.', tone: 'error' });
      }
    }}>
      {label}
    </button>
  );
}

function buildEmailEvidence(sourcePages: CrawlPage[]): EmailEvidence {
  const found = sourcePages.flatMap((page) => (page.emails || []).map((email) => ({
    value: email.toLowerCase(),
    pageUrl: page.url
  })));

  return {
    unique: [...new Set(found.map((item) => item.value))].sort(),
    found
  };
}

function buildSocialGroups(sourcePages: CrawlPage[]): SocialGroup[] {
  const groups = new Map<string, SocialOccurrence[]>();
  for (const page of sourcePages) {
    for (const [platform, values] of Object.entries(page.social || {})) {
      const current = groups.get(platform) || [];
      for (const value of (values || []) as string[]) {
        current.push({ value: String(value), pageUrl: page.url });
      }
      groups.set(platform, current);
    }
  }

  return [...groups.entries()]
    .map(([platform, found]) => ({
      platform,
      unique: [...new Set(found.map((item) => item.value))].sort(),
      found
    }))
    .filter((group) => group.found.length > 0)
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

function buildMetadataRows(page: CrawlPage) {
  const metadata = page.metadata || {};
  const rows: Array<[string, string | undefined]> = [
    ['Title', metadata.title],
    ['Description', metadata.description],
    ['Canonical', metadata.canonical],
    ['Language', metadata.language],
    ['Robots', metadata.robots],
    ['Author', metadata.author],
    ['Publisher', metadata.publisher],
    ['Generator', metadata.generator],
    ['Application', metadata.applicationName],
    ['Theme color', metadata.themeColor],
    ['OpenGraph title', metadata.ogTitle],
    ['OpenGraph type', metadata.ogType],
    ['OpenGraph image', metadata.ogImage],
    ['Twitter card', metadata.twitterCard],
    ['Twitter title', metadata.twitterTitle],
    ['Favicon', metadata.favicon],
    ['Manifest', metadata.manifest],
    ['AMP URL', metadata.ampUrl],
    ['JSON-LD', metadata.jsonLdTypes?.join(', ')],
    ['Keywords', metadata.keywords?.join(', ')]
  ];

  return rows.filter(([, value]) => Boolean(value)).map(([label, value]) => [label, String(value)] as [string, string]);
}

interface EmailEvidence {
  unique: string[];
  found: Array<{ value: string; pageUrl: string }>;
}

interface SocialOccurrence {
  value: string;
  pageUrl: string;
}

interface SocialGroup {
  platform: string;
  unique: string[];
  found: SocialOccurrence[];
}
