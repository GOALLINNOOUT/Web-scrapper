import { FileSearch, LoaderCircle, Search, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { toDomain } from '../lib/format.js';
import type { CrawlPage } from '../types.js';

interface MobileSearchPanelProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSearchPanel({ open, onClose }: MobileSearchPanelProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CrawlPage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery.trim()) {
      setResults([]);
      setNextCursor(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    api.searchWorkspace(debouncedQuery, { limit: 12 })
      .then((data) => {
        if (!cancelled) {
          setResults(data.items);
          setNextCursor(data.nextCursor);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  if (!open) return null;

  async function loadMore() {
    if (!nextCursor || !debouncedQuery.trim()) return;
    setIsLoadingMore(true);
    try {
      const data = await api.searchWorkspace(debouncedQuery, { limit: 12, cursor: nextCursor });
      setResults((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }

  function openResult(result: CrawlPage) {
    onClose();
    navigate(`/crawls/${result.crawlId}?page=${encodeURIComponent(result._id)}`, {
      state: { searchResult: result, focus: result.emails.length ? 'emails' : result.techStack?.length ? 'tech' : 'page' }
    });
  }

  function openDataExplorer() {
    onClose();
    navigate('/data', { state: { initialQuery: query } });
  }

  return (
    <div className="mobile-search-panel fixed inset-0 z-[260] bg-[var(--bg-canvas)]">
      <header className="flex h-16 items-center gap-2 border-b border-[var(--border-subtle)] px-4">
        <div className="grid h-11 min-w-0 flex-1 grid-cols-[18px_minmax(0,1fr)_28px] items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] px-3 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_rgba(10,110,255,0.15)]">
          <Search className="text-[var(--text-secondary)]" size={18} />
          <input
            ref={inputRef}
            className="min-w-0 border-0 bg-transparent text-[15px] font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, emails, domains"
          />
          {query ? <button className="grid h-7 w-7 place-items-center rounded-full bg-[var(--bg-raised)] text-[var(--text-secondary)]" type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : null}
        </div>
        <button className="mobile-icon-btn" type="button" aria-label="Settings" onClick={() => { onClose(); navigate('/settings'); }}>
          <Settings size={18} />
        </button>
        <button className="mobile-icon-btn" type="button" aria-label="Close search" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <main className="no-scrollbar h-[calc(100vh-64px)] overflow-y-auto overflow-x-hidden px-4 pb-8 pt-4">
        <div className="mx-auto w-full max-w-[430px]">
        <button className="mb-4 flex min-h-11 w-full items-center justify-between rounded-xl bg-[var(--accent)] px-4 text-left text-sm font-semibold text-white shadow-[0_8px_20px_rgba(10,110,255,0.18)]" type="button" onClick={openDataExplorer}>
          <span>Open Data Explorer</span>
          <span className="font-mono text-xs">{results.length || 'all'}</span>
        </button>

        {isSearching ? <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-base)] p-4 text-sm font-medium text-[var(--text-secondary)]"><LoaderCircle className="animate-spin" size={16} /> Searching workspace</div> : null}
        {!isSearching && query.trim() && results.length === 0 ? <div className="rounded-xl bg-[var(--bg-base)] p-6 text-center"><FileSearch className="mx-auto text-[var(--text-tertiary)]" size={34} /><p className="mt-3 text-sm font-semibold">No matches</p></div> : null}
        {!query.trim() ? <div className="rounded-xl bg-[var(--bg-base)] p-6 text-center"><Search className="mx-auto text-[var(--text-tertiary)]" size={34} /><p className="mt-3 text-sm font-semibold">Search your crawl archive</p></div> : null}

        <div className="grid gap-3">
          {results.map((result, index) => (
            <button className="mobile-tap w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-left" key={`${result._id}-${index}`} type="button" onClick={() => openResult(result)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <strong className="mobile-text-clamp text-[15px] font-semibold leading-5 text-[var(--text-primary)]">{result.metadata?.title || toDomain(result.url)}</strong>
                  <span className="mt-2 block truncate font-mono text-[11px] text-[var(--text-secondary)]">{result.url}</span>
                </div>
                {(result.score ?? 0) > 0 ? <span className="shrink-0 rounded-full bg-[var(--accent-light)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--accent)]">{result.score}</span> : null}
              </div>
              <div className="mt-3 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                <span>{result.emails.length} emails</span>
                <span>{result.links.length} links</span>
                <span className="max-w-full truncate">{toDomain(result.url)}</span>
              </div>
            </button>
          ))}
        </div>

        {nextCursor ? <button className="mt-4 h-11 w-full rounded-xl bg-[var(--bg-base)] text-sm font-semibold text-[var(--accent)]" type="button" onClick={loadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Loading...' : 'Load more'}</button> : null}
        </div>
      </main>
    </div>
  );
}
