import { Filter, Link as LinkIcon, LoaderCircle, Mail, Share2, Table2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { formatRelativeTime, toDomain } from '../lib/format.js';
import type { CrawlPage } from '../types.js';

type DataMode = 'pages' | 'emails' | 'links' | 'socials';

interface ExplorerFilters {
  q: string;
  domain: string;
  hasEmails: boolean;
  hasSocial: boolean;
  classification: string;
  techStack: string;
  minScore: number;
}

export function MobileDataExplorer() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { initialQuery?: string } | null;
  const [filters, setFilters] = useState<ExplorerFilters>({ q: routeState?.initialQuery || '', domain: '', hasEmails: false, hasSocial: false, classification: '', techStack: '', minScore: 0 });
  const [mode, setMode] = useState<DataMode>('pages');
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedFilters = useDebouncedValue(filters, 300);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    api.getData(toApiFilters(debouncedFilters))
      .then((data) => {
        if (!cancelled) {
          setPages(data.items);
          setNextCursor(data.nextCursor);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedFilters]);

  const rows = useMemo(() => buildRows(pages), [pages]);
  const counts = {
    pages: pages.length,
    emails: rows.emails.length,
    links: rows.links.length,
    socials: rows.socials.length
  };

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const data = await api.getData({ ...toApiFilters(debouncedFilters), cursor: nextCursor });
      setPages((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div className="mobile-page-enter px-4 pb-[112px] pt-2">
      <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
        <label className="grid h-11 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] px-3">
          <Table2 size={17} className="text-[var(--text-secondary)]" />
          <input className="min-w-0 border-0 bg-transparent text-sm font-medium outline-none" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Search archive" />
        </label>
        <button className="mobile-icon-btn h-11 w-11" type="button" aria-label="Filters" onClick={() => setFiltersOpen(true)}>
          <Filter size={18} />
        </button>
      </div>

      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
        {([
          ['pages', 'Pages', Table2],
          ['emails', 'Emails', Mail],
          ['links', 'Links', LinkIcon],
          ['socials', 'Socials', Share2]
        ] as Array<[DataMode, string, LucideIcon]>).map(([key, label, Icon]) => (
          <button className={`mobile-segment ${mode === key ? 'mobile-segment-active' : ''}`} key={String(key)} type="button" onClick={() => setMode(key as DataMode)}>
            <Icon size={15} />
            <span>{label}</span>
            <strong className="font-mono text-[11px]">{counts[key as DataMode]}</strong>
          </button>
        ))}
      </div>

      {isLoading ? <div className="mt-5 grid gap-2">{[0, 1, 2, 3].map((item) => <span className="mobile-skeleton h-20 rounded-xl" key={item} />)}</div> : null}
      {!isLoading ? <ResultList
        mode={mode}
        pages={pages}
        rows={rows}
        onOpenPage={(page) => navigate(`/crawls/${page.crawlId}?page=${encodeURIComponent(page._id)}`, { state: { searchResult: page } })}
      /> : null}
      {!isLoading && nextCursor ? <button className="mt-4 h-11 w-full rounded-xl bg-[var(--bg-base)] text-sm font-semibold text-[var(--accent)]" type="button" onClick={loadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Fetching...' : 'Fetch more archive data'}</button> : null}

      <MobileFilterSheet open={filtersOpen} filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
    </div>
  );
}

function ResultList({ mode, pages, rows, onOpenPage }: { mode: DataMode; pages: CrawlPage[]; rows: ReturnType<typeof buildRows>; onOpenPage: (page: CrawlPage) => void }) {
  if (mode === 'emails') return <Rows rows={rows.emails} empty="No emails found" />;
  if (mode === 'links') return <Rows rows={rows.links} empty="No links found" />;
  if (mode === 'socials') return <Rows rows={rows.socials} empty="No social links found" />;

  return (
    <div className="mt-5 grid gap-2">
      {pages.length === 0 ? <Empty text="No pages found" /> : null}
      {pages.map((page) => (
        <article className="mobile-archive-card mobile-crawl-card" key={page._id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <strong className="block truncate text-sm">{page.metadata?.title || toDomain(page.url)}</strong>
              <p className="mobile-text-clamp mt-1 font-mono text-[11px] text-[var(--text-secondary)]">{page.url}</p>
            </div>
            {(page.score || 0) > 0 ? <span className="rounded-full bg-[var(--accent-light)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--accent)]">{page.score}</span> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            <span>{page.emails.length} emails</span>
            <span>{page.links.length} links</span>
            <span>{formatRelativeTime(page.crawledAt)}</span>
          </div>
          <button className="mobile-open-action mt-3" type="button" onClick={() => onOpenPage(page)}>Open</button>
        </article>
      ))}
    </div>
  );
}

function Rows({ rows, empty }: { rows: ArchiveRow[]; empty: string }) {
  return (
    <div className="mt-5 grid gap-2">
      {rows.length === 0 ? <Empty text={empty} /> : null}
      {rows.map((row) => (
        <article className="mobile-archive-card mobile-crawl-card" key={row.id}>
          <p className="mobile-text-clamp font-mono text-xs font-semibold text-[var(--text-primary)]">{row.value}</p>
          <p className="mobile-text-clamp mt-2 text-[11px] font-semibold text-[var(--text-secondary)]">{row.domain || row.source}</p>
          {row.href ? <a className="mobile-open-action mt-3" href={row.href} target="_blank" rel="noreferrer">Open</a> : null}
        </article>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl bg-[var(--bg-base)] p-8 text-center text-sm font-semibold text-[var(--text-secondary)]">{text}</div>;
}

function MobileFilterSheet({ open, filters, onChange, onClose }: { open: boolean; filters: ExplorerFilters; onChange: (filters: ExplorerFilters) => void; onClose: () => void }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000]">
      <button className="mobile-sheet-overlay absolute inset-0 w-full" aria-label="Close filters" type="button" onClick={onClose} />
      <div className="mobile-sheet-panel absolute bottom-0 left-0 right-0 h-[70vh] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Filters</h2>
          <button className="mobile-icon-btn" type="button" aria-label="Close filters" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="grid gap-4">
          <MobileText label="Domain" value={filters.domain} onChange={(value) => onChange({ ...filters, domain: value })} />
          <MobileText label="Classification" value={filters.classification} onChange={(value) => onChange({ ...filters, classification: value })} />
          <MobileText label="Tech stack" value={filters.techStack} onChange={(value) => onChange({ ...filters, techStack: value })} />
          <label className="grid gap-2">
            <span className="text-sm font-medium">Minimum score <strong className="font-mono text-[var(--accent)]">{filters.minScore}</strong></span>
            <input className="mobile-range" min={0} max={100} type="range" value={filters.minScore} onChange={(event) => onChange({ ...filters, minScore: Number(event.target.value) })} />
          </label>
          <label className="flex min-h-12 items-center justify-between"><span>Has emails</span><input className="h-5 w-5 accent-[var(--accent)]" type="checkbox" checked={filters.hasEmails} onChange={(event) => onChange({ ...filters, hasEmails: event.target.checked })} /></label>
          <label className="flex min-h-12 items-center justify-between"><span>Has social links</span><input className="h-5 w-5 accent-[var(--accent)]" type="checkbox" checked={filters.hasSocial} onChange={(event) => onChange({ ...filters, hasSocial: event.target.checked })} /></label>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MobileText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2"><span className="text-sm font-medium">{label}</span><input className="h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 text-sm outline-none focus:border-[var(--accent)]" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function toApiFilters(filters: ExplorerFilters) {
  return {
    q: filters.q || undefined,
    domain: filters.domain || undefined,
    hasEmails: filters.hasEmails || undefined,
    hasSocial: filters.hasSocial || undefined,
    classification: filters.classification || undefined,
    techStack: filters.techStack || undefined,
    minScore: filters.minScore || undefined,
    limit: 25
  };
}

function buildRows(pages: CrawlPage[]) {
  const links = new Map<string, ArchiveRow>();
  const emails: ArchiveRow[] = [];
  const socials: ArchiveRow[] = [];
  for (const page of pages) {
    for (const link of page.links || []) links.set(link, { id: `link-${link}`, value: link, href: link, source: page.url, domain: page.domain || toDomain(page.url) });
    for (const email of page.emails || []) emails.push({ id: `email-${page._id}-${email}`, value: email, source: page.url, domain: page.domain || toDomain(page.url) });
    for (const [platform, values] of Object.entries(page.social || {})) {
      for (const value of values || []) socials.push({ id: `social-${platform}-${value}`, value, href: value, source: page.url, domain: String(platform) });
    }
  }
  return { links: [...links.values()], emails, socials };
}

interface ArchiveRow {
  id: string;
  value: string;
  source: string;
  domain: string;
  href?: string;
}
