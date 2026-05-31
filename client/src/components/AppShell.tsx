import { Command, FileSearch, LoaderCircle, Radar, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { watchSystemTheme } from '../theme.js';
import type { CrawlPage } from '../types.js';
import { FloatingCrawlMonitor } from './FloatingCrawlMonitor.jsx';
import { Sidebar } from './Sidebar.jsx';

export function AppShell() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMoreResults, setIsLoadingMoreResults] = useState(false);
  const [results, setResults] = useState<CrawlPage[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [nextSearchCursor, setNextSearchCursor] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 220);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => watchSystemTheme(), []);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setNextSearchCursor(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    api.searchWorkspace(debouncedQuery, { limit: 10 })
      .then((data) => {
        if (!cancelled) {
          setResults(data.items);
          setNextSearchCursor(data.nextCursor);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  async function loadMoreSearchResults() {
    if (!debouncedQuery.trim() || !nextSearchCursor) return;

    setIsLoadingMoreResults(true);
    try {
      const data = await api.searchWorkspace(debouncedQuery, { limit: 10, cursor: nextSearchCursor });
      setResults((current) => [...current, ...data.items]);
      setNextSearchCursor(data.nextCursor);
    } finally {
      setIsLoadingMoreResults(false);
    }
  }

  function closeSearch() {
    setQuery('');
    setResults([]);
    setNextSearchCursor(null);
    setIsSearchFocused(false);
  }

  function openSearchResult(result: CrawlPage) {
    closeSearch();
    navigate(`/crawls/${result.crawlId}?page=${encodeURIComponent(result._id)}`, {
      state: { searchResult: result }
    });
  }

  const showSearchPanel = isSearchFocused && (query.trim() || results.length > 0);

  return (
    <div className="h-screen overflow-hidden bg-[#fafaf8] text-[#111110]">
      <div className={`grid h-screen overflow-hidden bg-[#fafaf8] transition-[grid-template-columns] duration-300 ease-[var(--ease-out-expo)] max-[900px]:grid-cols-1 ${sidebarCollapsed ? 'grid-cols-[88px_minmax(0,1fr)]' : 'grid-cols-[260px_minmax(0,1fr)]'}`}>
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
        <main className="h-screen min-w-0 overflow-y-auto bg-[#fafaf8] px-6 pb-8 pt-0 max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:px-3.5 max-[900px]:pb-3.5 max-[900px]:pt-0">
          <header className="sticky top-0 z-30 mb-6 grid min-h-20 grid-cols-[minmax(280px,610px)_auto] items-center justify-between gap-4 border-b border-[#eaeae6] bg-[#fafaf8]/90 p-4 backdrop-blur-xl max-[760px]:grid-cols-1">
            <div className="relative flex h-[52px] w-full items-center gap-3 rounded-lg border border-[#eaeae6] bg-white px-4 shadow-sm transition focus-within:border-[#c8c8c2] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(10,110,255,0.20)]">
              <Search className="text-[#636360]" size={18} />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-[#111110] outline-none placeholder:text-[#9b9b97]"
                ref={searchRef}
                value={query}
                onBlur={() => window.setTimeout(() => setIsSearchFocused(false), 140)}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                placeholder="Search workspace"
              />
              {query ? (
                <button className="grid h-8 w-8 place-items-center rounded-md border border-[#eaeae6] bg-[#f5f5f2] text-[#636360] shadow-sm transition hover:text-[#111110]" type="button" onClick={() => {
                  setQuery('');
                  setResults([]);
                  searchRef.current?.focus();
                }} title="Clear search">
                  <X size={15} />
                </button>
              ) : null}
              <kbd className="inline-flex items-center gap-1 rounded-md border border-[#eaeae6] bg-[#f5f5f2] px-2 py-1 text-xs font-semibold text-[#636360]"><Command size={13} /> K</kbd>
              {showSearchPanel ? (
                <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-30 max-h-[min(68vh,620px)] overflow-hidden rounded-lg border border-[#eaeae6] bg-white p-2 shadow-float">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
                    <span>Workspace search</span>
                    <small className="text-xs font-medium text-[#636360]">{query.trim() ? `${results.length}${nextSearchCursor ? '+' : ''} matches` : 'Type to search'}</small>
                  </div>
                  <div className="max-h-[calc(min(68vh,620px)-58px)] overflow-y-auto pr-1">
                    {isSearching ? (
                      <span className="flex items-center gap-2 rounded-md px-3 py-3 text-sm font-medium text-[#636360]"><LoaderCircle className="animate-spin" size={15} /> Searching workspace...</span>
                    ) : null}
                    {!isSearching && results.length === 0 ? (
                      <span className="flex items-center gap-2 rounded-md px-3 py-3 text-sm font-medium text-[#636360]"><FileSearch size={15} /> No matches in this workspace.</span>
                    ) : null}
                    {results.map((result) => (
                      <button
                        className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-3 transition hover:bg-[#f5f5f2]"
                        key={result._id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openSearchResult(result)}
                      >
                        <span className="grid h-[34px] w-[34px] place-items-center rounded-md bg-[#ebf2ff] text-sm font-semibold text-brand-700">{(result.domain || 'W').slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0">
                          <strong className="block truncate text-sm">{result.metadata?.title || result.url}</strong>
                          <small className="block truncate font-mono text-xs text-[#636360]">{result.domain || result.url}</small>
                        </span>
                        <em className="rounded-md bg-[#f5f5f2] px-2 py-1 text-xs not-italic text-[#636360]">{result.emails.length} emails</em>
                      </button>
                    ))}
                    {nextSearchCursor ? (
                      <button
                        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#f5f5f2] px-4 text-sm font-semibold text-brand-800 transition hover:bg-[#ebf2ff] disabled:cursor-wait disabled:opacity-70"
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={loadMoreSearchResults}
                        disabled={isLoadingMoreResults}
                      >
                        {isLoadingMoreResults ? <LoaderCircle className="animate-spin" size={15} /> : null}
                        {isLoadingMoreResults ? 'Loading more' : 'Load more results'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2.5 max-[760px]:justify-between">
              <Link className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700" to="/"><Radar size={17} /> Start</Link>
            </div>
          </header>
          <Outlet />
        </main>
        <FloatingCrawlMonitor />
      </div>
    </div>
  );
}
