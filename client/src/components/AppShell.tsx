import { Bell, ChevronLeft, Command, FileSearch, Globe2, ListTree, LoaderCircle, Plus, Radar, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { LIVE_EVENT_NAME, type ClientLiveEvent } from '../hooks/useLiveEvents.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { watchSystemTheme } from '../theme.js';
import type { CrawlJob, CrawlPage } from '../types.js';
import { FloatingCrawlMonitor } from './FloatingCrawlMonitor.jsx';
import { MobileNewCrawlSheet } from './MobileNewCrawlSheet.jsx';
import { MobileSearchPanel } from './MobileSearchPanel.jsx';
import { Sidebar } from './Sidebar.jsx';

export function AppShell() {
  const isMobile = useMediaQuery('(max-width: 899px)');

  if (isMobile) return <MobileAppShell />;
  return <DesktopAppShell />;
}

function DesktopAppShell() {
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
    <div className="desktop-shell h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className={`grid h-screen overflow-hidden bg-[var(--bg-canvas)] transition-[grid-template-columns] duration-300 ease-[var(--ease-out-expo)] max-[900px]:grid-cols-1 ${sidebarCollapsed ? 'grid-cols-[88px_minmax(0,1fr)]' : 'grid-cols-[260px_minmax(0,1fr)]'}`}>
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
        <main className="desktop-main h-screen min-w-0 overflow-x-hidden overflow-y-auto bg-[var(--bg-canvas)] px-6 pb-8 pt-0 max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:px-3.5 max-[900px]:pb-3.5 max-[900px]:pt-0">
          <header className="desktop-command-header sticky top-0 z-30 mb-6 grid min-h-20 grid-cols-[minmax(280px,680px)_auto] items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-canvas)_88%,transparent)] p-4 backdrop-blur-xl max-[760px]:grid-cols-1">
            <div className="desktop-command-bar relative flex h-[52px] w-full items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 shadow-sm transition focus-within:border-[var(--accent)] focus-within:bg-[var(--bg-base)] focus-within:shadow-[0_0_0_3px_rgba(10,110,255,0.16)]">
              <Search className="text-[var(--text-secondary)]" size={18} />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                ref={searchRef}
                value={query}
                onBlur={() => window.setTimeout(() => setIsSearchFocused(false), 140)}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                placeholder="Search workspace"
              />
              {query ? (
                <button className="grid h-8 w-8 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-[var(--text-secondary)] shadow-sm transition hover:text-[var(--text-primary)]" type="button" onClick={() => {
                  setQuery('');
                  setResults([]);
                  searchRef.current?.focus();
                }} title="Clear search">
                  <X size={15} />
                </button>
              ) : null}
              <kbd className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]"><Command size={13} /> K</kbd>
              {showSearchPanel ? (
                <div className="desktop-search-popover absolute left-0 right-0 top-[calc(100%+10px)] z-30 max-h-[min(68vh,620px)] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 shadow-float">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
                    <span>Workspace search</span>
                    <small className="text-xs font-medium text-[var(--text-secondary)]">{query.trim() ? `${results.length}${nextSearchCursor ? '+' : ''} matches` : 'Type to search'}</small>
                  </div>
                  <div className="max-h-[calc(min(68vh,620px)-58px)] overflow-y-auto pr-1">
                    {isSearching ? (
                      <span className="flex items-center gap-2 rounded-md px-3 py-3 text-sm font-medium text-[var(--text-secondary)]"><LoaderCircle className="animate-spin" size={15} /> Searching workspace...</span>
                    ) : null}
                    {!isSearching && results.length === 0 ? (
                      <span className="flex items-center gap-2 rounded-md px-3 py-3 text-sm font-medium text-[var(--text-secondary)]"><FileSearch size={15} /> No matches in this workspace.</span>
                    ) : null}
                    {results.map((result) => (
                      <button
                        className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-3 transition hover:bg-[var(--bg-raised)]"
                        key={result._id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openSearchResult(result)}
                      >
                        <span className="grid h-[34px] w-[34px] place-items-center rounded-md bg-[var(--accent-light)] text-sm font-semibold text-[var(--accent)]">{(result.domain || 'W').slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0">
                          <strong className="block truncate text-sm">{result.metadata?.title || result.url}</strong>
                          <small className="block truncate font-mono text-xs text-[var(--text-secondary)]">{result.domain || result.url}</small>
                        </span>
                        <em className="rounded-md bg-[var(--bg-raised)] px-2 py-1 text-xs not-italic text-[var(--text-secondary)]">{result.emails.length} emails</em>
                      </button>
                    ))}
                    {nextSearchCursor ? (
                      <button
                        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--bg-raised)] px-4 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-light)] disabled:cursor-wait disabled:opacity-70"
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
              <Link className="desktop-primary-action inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)]" to="/"><Radar size={17} /> Start</Link>
            </div>
          </header>
          <Outlet />
        </main>
        <FloatingCrawlMonitor />
      </div>
    </div>
  );
}

function MobileAppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hasUnreadMonitor, setHasUnreadMonitor] = useState(false);

  useEffect(() => watchSystemTheme(), []);

  useEffect(() => {
    api.getMonitoring()
      .then((data) => setHasUnreadMonitor((data.counts.unread || 0) > 0))
      .catch(() => setHasUnreadMonitor(false));
  }, []);

  const isOverview = location.pathname === '/';
  const isDetail = /^\/(crawls|domains)\/[^/]+/.test(location.pathname);
  const title = getMobileTitle(location.pathname);

  useEffect(() => {
    if (location.pathname.startsWith('/monitoring')) setHasUnreadMonitor(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleLiveMonitorUpdate(event: Event) {
      const detail = (event as CustomEvent<ClientLiveEvent>).detail;
      if (!['workspace.updated', 'domain.updated'].includes(detail.type)) return;
      if (!location.pathname.startsWith('/monitoring')) setHasUnreadMonitor(true);
    }

    window.addEventListener(LIVE_EVENT_NAME, handleLiveMonitorUpdate);
    return () => window.removeEventListener(LIVE_EVENT_NAME, handleLiveMonitorUpdate);
  }, [location.pathname]);

  function openSheet() {
    navigator.vibrate?.([10]);
    setSheetOpen(true);
  }

  useEffect(() => {
    function handleOpenNewCrawl() {
      openSheet();
    }

    window.addEventListener('web-intel-open-new-crawl', handleOpenNewCrawl);
    return () => window.removeEventListener('web-intel-open-new-crawl', handleOpenNewCrawl);
  }, []);

  function handleCreated(job: CrawlJob) {
    navigate('/');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('web-intel-mobile-crawl-created', { detail: job }));
    }, 0);
  }

  return (
    <div className="h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <main className="mobile-shell-scroll no-scrollbar">
        <header className={`mobile-top-bar ${isOverview ? '' : 'sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/90 backdrop-blur-xl'}`}>
          <div className="flex min-w-0 items-center gap-2">
            {isDetail ? (
              <button className="mobile-icon-btn -ml-2" type="button" aria-label="Go back" onClick={() => navigate(-1)}>
                <ChevronLeft size={22} />
              </button>
            ) : null}
            <h1 className="truncate text-[26px] font-semibold leading-none tracking-[-0.03em]">{title}</h1>
          </div>
          <button className="mobile-icon-btn" type="button" aria-label="Search workspace" onClick={() => setSearchOpen(true)}>
            <Search size={18} />
          </button>
        </header>
        <Outlet />
      </main>

      <nav className="mobile-tab-bar" aria-label="Primary">
        <MobileTab to="/" label="Overview" icon={Radar} end />
        <MobileTab to="/crawls" label="Crawls" icon={ListTree} />
        <div className="flex flex-col items-center justify-start">
          <button className="mobile-fab" type="button" aria-label="New Crawl" onClick={openSheet}>
            <Plus size={22} />
          </button>
          <span className="mt-1 text-[10px] font-medium text-[var(--text-tertiary)]">New Crawl</span>
        </div>
        <MobileTab to="/domains" label="Domains" icon={Globe2} />
        <MobileTab to="/monitoring" label="Monitor" icon={Bell} badge={hasUnreadMonitor} />
      </nav>

      <MobileNewCrawlSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onCreated={handleCreated} />
      <MobileSearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function MobileTab({ to, label, icon: Icon, badge, end = false }: { to: string; label: string; icon: LucideIcon; badge?: boolean; end?: boolean }) {
  return (
    <NavLink
      className={({ isActive }) => `mobile-tab ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'}`}
      end={end}
      to={to}
    >
      {({ isActive }) => (
        <>
          <span className="relative grid h-7 place-items-center">
            <Icon className={isActive ? 'mobile-tab-active-icon' : ''} size={22} />
            {badge ? <span className="mobile-alert-dot" /> : null}
          </span>
          <span className="text-[10px] font-medium">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function getMobileTitle(pathname: string) {
  if (pathname.startsWith('/crawls/')) return 'Crawl Detail';
  if (pathname.startsWith('/crawls')) return 'Crawls';
  if (pathname.startsWith('/domains/')) return 'Domain';
  if (pathname.startsWith('/domains')) return 'Domains';
  if (pathname.startsWith('/monitoring')) return 'Monitor';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/data')) return 'Explorer';
  return 'Overview';
}
