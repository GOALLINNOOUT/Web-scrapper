import { useEffect, useMemo, useState } from 'react';
import { Link as LinkIcon, Mail, Share2, Table2 } from 'lucide-react';
import { api } from '../api.js';
import { CopyButton } from '../components/CopyButton.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { LoadMoreButton } from '../components/LoadMoreButton.jsx';
import { LoadingState } from '../components/LoadingState.jsx';
import { MetadataPreviewButton } from '../components/MetadataPreviewButton.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { displayTechStack } from '../lib/format.js';
import type { CrawlPage } from '../types.js';
import { MobileDataExplorer } from './MobileDataExplorer.jsx';

interface ExplorerFilters {
  q: string;
  domain: string;
  hasEmails: boolean;
  hasSocial: boolean;
  classification: string;
  techStack: string;
  minScore: number;
}

type DataMode = 'pages' | 'links' | 'emails' | 'socials';

const PAGE_SIZE = 25;
const DISPLAY_LIMIT = 25;

export function DataExplorer() {
  const isMobile = useMediaQuery('(max-width: 899px)');
  if (isMobile) return <MobileDataExplorer />;
  return <DesktopDataExplorer />;
}

function DesktopDataExplorer() {
  const [filters, setFilters] = useState<ExplorerFilters>({ q: '', domain: '', hasEmails: false, hasSocial: false, classification: '', techStack: '', minScore: 0 });
  const [mode, setMode] = useState<DataMode>('pages');
  const [visibleCount, setVisibleCount] = useState(DISPLAY_LIMIT);
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const debouncedFilters = useDebouncedValue(filters, 300);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(null);
    setVisibleCount(DISPLAY_LIMIT);
    api.getData({
      q: debouncedFilters.q,
      domain: debouncedFilters.domain,
      hasEmails: debouncedFilters.hasEmails || undefined,
      hasSocial: debouncedFilters.hasSocial || undefined,
      classification: debouncedFilters.classification || undefined,
      techStack: debouncedFilters.techStack || undefined,
      minScore: debouncedFilters.minScore || undefined,
      limit: PAGE_SIZE
    }).then((data) => {
      setPages(data.items);
      setNextCursor(data.nextCursor);
    }).catch(setLoadError).finally(() => setIsLoading(false));
  }, [debouncedFilters]);

  useEffect(() => {
    setVisibleCount(DISPLAY_LIMIT);
  }, [mode]);

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const nextPage = await api.getData({
        q: debouncedFilters.q,
        domain: debouncedFilters.domain,
        hasEmails: debouncedFilters.hasEmails || undefined,
        hasSocial: debouncedFilters.hasSocial || undefined,
        classification: debouncedFilters.classification || undefined,
        techStack: debouncedFilters.techStack || undefined,
        minScore: debouncedFilters.minScore || undefined,
        limit: PAGE_SIZE,
        cursor: nextCursor
      });
      setPages((current) => [...current, ...nextPage.items]);
      setNextCursor(nextPage.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }

  const rows = useMemo(() => buildRows(pages), [pages]);
  const uniquePages = useMemo(() => dedupePages(pages), [pages]);
  const modes = [
    { key: 'pages' as const, label: 'Pages', icon: Table2, count: uniquePages.length },
    { key: 'links' as const, label: 'Links', icon: LinkIcon, count: rows.links.length },
    { key: 'emails' as const, label: 'Emails', icon: Mail, count: rows.emails.length },
    { key: 'socials' as const, label: 'Socials', icon: Share2, count: rows.socials.length }
  ];

  return (
    <div className="desktop-page grid gap-6">
      <header>
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Data Explorer</span>
        <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Searchable intelligence engine</h1>
        <p className="mt-2 text-[16px] text-[#636360]">Search domains, contacts, metadata, content signals, and source evidence from every crawl.</p>
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        {modes.map((item) => {
          const Icon = item.icon;
          const active = mode === item.key;
          return (
            <button
              className={`flex items-center justify-between gap-3 rounded-lg border p-4 text-left transition ${active ? 'border-brand-200 bg-[#ebf2ff] text-brand-800' : 'border-[#eaeae6] bg-white text-[#636360] hover:bg-[#f5f5f2]'}`}
              key={item.key}
              type="button"
              onClick={() => setMode(item.key)}
            >
              <span className="inline-flex items-center gap-2 font-extrabold"><Icon size={17} /> {item.label}</span>
              <strong>{item.count}</strong>
            </button>
          );
        })}
      </div>

      {isLoading ? <LoadingState title="Loading archive data" rows={5} /> : loadError ? <ErrorState error={loadError} title="Could not load archive data" onRetry={() => {
        setFilters((current) => ({ ...current }));
      }} /> : renderTable(mode, uniquePages, rows, visibleCount, hasActiveFilter(filters))}
      {!isLoading ? (
        <div className="flex flex-wrap justify-center gap-3">
          {modeHasMore(mode, uniquePages, rows, visibleCount) ? (
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#c8c8c2] bg-white px-5 font-bold text-brand-800 transition hover:bg-[#efefeb]"
              type="button"
              onClick={() => setVisibleCount((current) => current + DISPLAY_LIMIT)}
            >
              Show 25 more {mode}
            </button>
          ) : null}
          <LoadMoreButton hasMore={Boolean(nextCursor)} isLoading={isLoadingMore} onClick={loadMore} label="Fetch more archive data" loadingLabel="Fetching archive data" />
        </div>
      ) : null}
    </div>
  );
}

function renderTable(mode: DataMode, pages: CrawlPage[], rows: ReturnType<typeof buildRows>, visibleCount: number, filtered: boolean) {
  if (mode === 'links') {
    return (
      <DataTable
        rows={rows.links.slice(0, visibleCount)}
        empty={filtered ? 'No links match the current filters.' : 'No links found in the loaded archive.'}
        columns={[
          { key: 'value', label: 'Link', render: (row) => <CopyableLink value={row.value} /> },
          { key: 'source', label: 'Found on', render: (row) => row.source },
          { key: 'domain', label: 'Domain' }
        ]}
      />
    );
  }

  if (mode === 'emails') {
    return (
      <DataTable
        rows={rows.emails.slice(0, visibleCount)}
        empty={filtered ? 'No emails match the current filters.' : 'No emails found in the loaded archive.'}
        columns={[
          { key: 'value', label: 'Email', render: (row) => <CopyableText value={row.value} label="Copy email" /> },
          { key: 'source', label: 'Found on', render: (row) => row.source },
          { key: 'domain', label: 'Domain' }
        ]}
      />
    );
  }

  if (mode === 'socials') {
    return (
      <DataTable
        rows={rows.socials.slice(0, visibleCount)}
        empty={filtered ? 'No social links match the current filters.' : 'No social links found in the loaded archive.'}
        columns={[
          { key: 'platform', label: 'Platform', render: (row) => <span className="capitalize">{row.platform}</span> },
          { key: 'value', label: 'Profile', render: (row) => <CopyableLink value={row.value} /> },
          { key: 'source', label: 'Found on', render: (row) => row.source }
        ]}
      />
    );
  }

  return (
    <DataTable
      rows={pages.slice(0, visibleCount)}
      empty={filtered ? 'No pages match the current filters.' : 'No pages found in the loaded archive.'}
      columns={[
        { key: 'url', label: 'URL', render: (page) => <CopyableLink value={page.url} /> },
        { key: 'title', label: 'Title', render: (page) => page.metadata?.title || 'Untitled' },
        { key: 'links', label: 'Links', render: (page) => page.links?.length || 0 },
        { key: 'emails', label: 'Emails', render: (page) => page.emails?.length || 0 },
        { key: 'social', label: 'Socials', render: (page) => new Set(Object.values(page.social || {}).flat()).size },
        { key: 'techStack', label: 'Tech', render: (page) => displayTechStack(page.techStack).slice(0, 3).join(', ') || 'None' },
        { key: 'score', label: 'Score', render: (page) => page.score ?? 0 }
      ]}
    />
  );
}

function buildRows(pages: CrawlPage[]) {
  const links = new Map<string, ArchiveRow>();
  const emails: ArchiveRow[] = [];
  const socials: Array<ArchiveRow & { platform: string }> = [];

  for (const page of pages) {
    for (const link of page.links || []) {
      if (!links.has(link)) links.set(link, toRow(link, page));
    }

    for (const [index, email] of (page.emails || []).entries()) {
      const normalized = email.toLowerCase();
      emails.push(toRow(normalized, page, `email-${index}`));
    }

    for (const [platform, values] of Object.entries(page.social || {})) {
      for (const [index, value] of (values || []).entries()) {
        socials.push({ ...toRow(value, page, `${platform}-${index}`), platform });
      }
    }
  }

  return {
    links: [...links.values()],
    emails,
    socials
  };
}

function dedupePages(pages: CrawlPage[]) {
  const unique = new Map<string, CrawlPage>();
  for (const page of pages) {
    if (!unique.has(page.url)) unique.set(page.url, page);
  }
  return [...unique.values()];
}

function modeHasMore(mode: DataMode, pages: CrawlPage[], rows: ReturnType<typeof buildRows>, visibleCount: number) {
  if (mode === 'pages') return pages.length > visibleCount;
  if (mode === 'links') return rows.links.length > visibleCount;
  if (mode === 'emails') return rows.emails.length > visibleCount;
  return rows.socials.length > visibleCount;
}

function hasActiveFilter(filters: ExplorerFilters) {
  return Boolean(filters.q.trim() || filters.domain.trim() || filters.hasEmails || filters.hasSocial || filters.classification || filters.techStack.trim() || filters.minScore);
}

function toRow(value: string, page: CrawlPage, suffix = ''): ArchiveRow {
  return {
    id: `${page._id}-${value}-${suffix}`,
    value,
    source: page.metadata?.title || page.url,
    domain: page.domain || ''
  };
}

function CopyableLink({ value }: { value: string }) {
  return (
    <span className="group/copy inline-flex max-w-full items-center gap-2">
      <a className="min-w-0 truncate font-semibold text-brand-800 hover:text-brand-600" href={value} target="_blank" rel="noreferrer">{value}</a>
      <span className="opacity-0 transition group-hover/copy:opacity-100 group-focus-within/copy:opacity-100">
        <CopyButton value={value} label="Copy link" />
      </span>
      <MetadataPreviewButton url={value} />
    </span>
  );
}

function CopyableText({ value, label }: { value: string; label: string }) {
  return (
    <span className="group/copy inline-flex max-w-full items-center gap-2">
      <span className="min-w-0 truncate font-semibold">{value}</span>
      <span className="opacity-0 transition group-hover/copy:opacity-100 group-focus-within/copy:opacity-100">
        <CopyButton value={value} label={label} />
      </span>
    </span>
  );
}

interface ArchiveRow {
  id: string;
  value: string;
  source: string;
  domain: string;
}
