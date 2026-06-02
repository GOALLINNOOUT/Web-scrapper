import { Activity, Bell, Check, CheckCircle2, ChevronRight, Eye, Globe2, LoaderCircle, Mail, Plus, Radar, Search, Sparkles, Wand2, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { LoadingState } from '../components/LoadingState.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { normalizeMonitorDomain } from '../lib/monitorDomain.js';
import { showToast } from '../toast.js';
import type { ChangeEvent, MonitoringProfile, MonitoringSummary } from '../types.js';
import { MobileMonitoring } from './MobileMonitoring.jsx';

const monitorTypes = [
  { value: 'competitive_intelligence', label: 'Competitive Intelligence' },
  { value: 'lead_discovery', label: 'Lead Discovery' },
  { value: 'seo_monitoring', label: 'SEO Monitoring' },
  { value: 'infrastructure_monitoring', label: 'Infrastructure Monitoring' },
  { value: 'custom', label: 'Custom' }
] as const;

export function Monitoring() {
  const isMobile = useMediaQuery('(max-width: 899px)');
  if (isMobile) return <MobileMonitoring />;
  return <DesktopMonitoring />;
}

function DesktopMonitoring() {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [activeDomain, setActiveDomain] = useState<string>('');
  const [domainDetail, setDomainDetail] = useState<{ profile: MonitoringProfile; events: ChangeEvent[] } | null>(null);
  const [domain, setDomain] = useState('');
  const [monitoringType, setMonitoringType] = useState<MonitoringProfile['monitoringType']>('competitive_intelligence');
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSavingRecommendations, setIsSavingRecommendations] = useState(false);
  const [acceptingSuggestionUrl, setAcceptingSuggestionUrl] = useState('');
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  const [selectedRecommendationUrls, setSelectedRecommendationUrls] = useState<Set<string>>(new Set());
  const [monitorError, setMonitorError] = useState('');
  const normalizedDomain = normalizeMonitorDomain(domain);
  const isValidDomain = Boolean(normalizedDomain);

  async function load() {
    const data = await api.getMonitoring();
    setSummary(data);
    if (!activeDomain && data.profiles[0]) setActiveDomain(data.profiles[0].domain);
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    load().catch(console.error).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeDomain) return;
    let cancelled = false;
    setIsLoadingDetail(true);
    api.getMonitoringProfile(activeDomain)
      .then((data) => {
        if (!cancelled) setDomainDetail({ profile: data.profile, events: data.events });
      })
      .catch(() => {
        if (!cancelled) setDomainDetail(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDomain]);

  useEffect(() => {
    if (!domainDetail) return;
    const monitored = new Set(domainDetail.profile.monitoredPages.map((page) => page.url));
    const recommended = new Set(domainDetail.profile.recommendedPages.filter((page) => !monitored.has(page.url)).map((page) => page.url));
    setSelectedRecommendationUrls(recommended);
  }, [domainDetail?.profile._id, domainDetail?.profile.updatedAt]);

  async function refreshProfile(domainName = activeDomain) {
    if (!domainName) return;
    const data = await api.getMonitoringProfile(domainName);
    setDomainDetail({ profile: data.profile, events: data.events });
  }

  function selectDomain(domainName: string) {
    setActiveDomain(domainName);
  }

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidDomain) {
      setMonitorError('Enter a valid domain like example.com.');
      return;
    }
    setIsAdding(true);
    setMonitorError('');
    try {
      const result = await api.createMonitoringProfile({ domain: normalizedDomain, monitoringType });
      showToast({ title: 'Monitoring started', description: result.profile.domain, tone: 'success' });
      setDomain('');
      await load();
      setActiveDomain(result.profile.domain);
      await refreshProfile(result.profile.domain);
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : 'This domain cannot be monitored.');
    } finally {
      setIsAdding(false);
    }
  }

  async function acceptRecommendations(profile: MonitoringProfile) {
    const monitoredUrls = new Set(profile.monitoredPages.map((page) => page.url));
    const pendingRecommendations = profile.recommendedPages.filter((page) => !monitoredUrls.has(page.url));
    setIsSavingRecommendations(true);
    try {
      const selected = pendingRecommendations
        .filter((page) => selectedRecommendationUrls.has(page.url))
        .map((page) => ({ ...page, enabled: true }));
      if (selected.length === 0) {
        showToast({ title: 'No recommendations selected', description: 'Select at least one page to monitor, or dismiss the recommendation.', tone: 'message' });
        return;
      }
      const remainingRecommendations = pendingRecommendations.filter((page) => !selectedRecommendationUrls.has(page.url));
      const updated = await api.updateMonitoringProfile(profile._id, { monitoredPages: [...profile.monitoredPages, ...selected], recommendedPages: remainingRecommendations });
      setDomainDetail((current) => current ? { ...current, profile: updated } : current);
      await load();
      showToast({ title: 'Recommendations accepted', description: `${updated.monitoredPages.length} pages are now monitored.`, tone: 'success' });
    } finally {
      setIsSavingRecommendations(false);
    }
  }

  function toggleRecommendation(url: string) {
    setSelectedRecommendationUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function dismissRecommendation(profile: MonitoringProfile, url: string) {
    const updated = await api.updateMonitoringProfile(profile._id, {
      recommendedPages: profile.recommendedPages.filter((page) => page.url !== url)
    });
    setDomainDetail((current) => current ? { ...current, profile: updated } : current);
    setSelectedRecommendationUrls((current) => {
      const next = new Set(current);
      next.delete(url);
      return next;
    });
    await load();
    showToast({ title: 'Recommendation dismissed', description: updated.domain, tone: 'message' });
  }

  async function acceptSuggestedPage(url: string) {
    setAcceptingSuggestionUrl(url);
    try {
      const profile = await api.acceptMonitoringSuggestion({ url, monitoringType: 'seo_monitoring' });
      await load();
      setActiveDomain(profile.domain);
      await refreshProfile(profile.domain);
      showToast({ title: 'Page added to monitoring', description: profile.domain, tone: 'success' });
    } finally {
      setAcceptingSuggestionUrl('');
    }
  }

  const groupedEvents = useMemo(() => groupEvents(summary?.changeFeed || []), [summary]);

  if (isLoading || !summary) return <LoadingState title="Loading intelligence feed" rows={7} />;

  return (
    <div className="desktop-page grid min-w-0 gap-6 overflow-x-hidden">
      <header className="flex items-end justify-between gap-4 max-[900px]:grid">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Monitoring</span>
          <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">What changed since you last looked</h1>
          <p className="mt-2 max-w-3xl text-[16px] text-[#636360]">An intelligence feed for important pages, contacts, technology, DNS, WHOIS, and content shifts.</p>
        </div>
      </header>

      <form className="desktop-card grid min-w-0 grid-cols-[minmax(0,1fr)_240px_150px] gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 shadow-panel max-[860px]:grid-cols-1" onSubmit={addDomain}>
        <div className="min-w-0">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636360]" size={16} />
            <input className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] pl-10 pr-3 text-sm font-semibold outline-none focus:border-brand-500 focus:bg-white" value={domain} onChange={(event) => { setDomain(event.target.value); setMonitorError(''); }} placeholder="Add domain to monitor, e.g. example.com" />
          </label>
          {domain.trim() && !isValidDomain ? <p className="mt-2 text-xs font-bold text-red-700">Enter a domain like example.com. Paths, ports, and private hosts are not allowed.</p> : null}
          {monitorError ? <p className="mt-2 text-xs font-bold text-red-700">{monitorError}</p> : null}
        </div>
        <select className="h-12 rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-3 text-sm font-bold outline-none focus:border-brand-500 focus:bg-white" value={monitoringType} onChange={(event) => setMonitoringType(event.target.value as MonitoringProfile['monitoringType'])}>
          {monitorTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-extrabold text-white hover:bg-brand-700 disabled:opacity-60" disabled={isAdding || !isValidDomain} type="submit"><Plus size={16} /> Add</button>
      </form>

      <div className="grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-4 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
        <MetricCard icon={Sparkles} label="Changes today" value={summary.counts.changesToday} />
        <MetricCard icon={Globe2} label="New pages" value={summary.counts.newPages} />
        <MetricCard icon={Mail} label="New emails" value={summary.counts.newEmails} />
        <MetricCard icon={Radar} label="Monitored domains" value={summary.health.monitoredDomains} />
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-5 max-[1180px]:grid-cols-1">
        <section className="desktop-card min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-extrabold">Change feed</h2>
            <Bell className="text-brand-600" size={20} />
          </div>
          <div className="grid max-h-[720px] gap-5 overflow-y-auto pr-1">
            {groupedEvents.length === 0 ? <EmptyState title="No changes detected" body="Add a domain or wait for the next monitoring check to populate this intelligence feed." /> : null}
            {groupedEvents.map(([group, events]) => (
              <div key={group}>
                <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">{group}</h3>
                <div className="grid gap-2">
                  {events.map((event) => <ChangeRow event={event} key={event._id} onDomain={setActiveDomain} />)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="grid h-fit min-w-0 gap-5">
          {summary.suggestedPages.length > 0 ? (
            <section className="desktop-card min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-panel">
              <button className="mb-4 flex w-full min-w-0 items-center justify-between gap-3 text-left" onClick={() => setSuggestionsCollapsed((value) => !value)} type="button" aria-expanded={!suggestionsCollapsed}>
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-extrabold">
                    Suggested from previous crawls
                    <span className="rounded-md bg-[#ebf2ff] px-2 py-1 text-xs font-extrabold text-brand-700">{summary.suggestedPages.length}</span>
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-[#636360]">Up to 15 page suggestions per day.</p>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-brand-600">
                  <Wand2 size={19} />
                  <ChevronRight className={`transition ${suggestionsCollapsed ? '' : 'rotate-90'}`} size={16} />
                </span>
              </button>
              {!suggestionsCollapsed ? (
                <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
                  {summary.suggestedPages.map((page) => (
                    <article className="grid min-w-0 gap-2 rounded-lg bg-[#f5f5f2] p-3" key={page.url}>
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <strong className="block truncate">{page.label}</strong>
                          <span className="mt-1 block truncate text-xs font-bold text-[#636360]">{page.domain}</span>
                        </div>
                        <span className="shrink-0 text-xs font-extrabold text-brand-700">{page.score}</span>
                      </div>
                      <p className="line-clamp-2 text-xs font-semibold text-[#636360]">{page.reason}</p>
                      <button className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md bg-white px-3 text-xs font-extrabold text-brand-700 transition hover:bg-[#ebf2ff] disabled:cursor-wait disabled:opacity-60" disabled={acceptingSuggestionUrl === page.url} onClick={() => acceptSuggestedPage(page.url)} type="button">
                        {acceptingSuggestionUrl === page.url ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />}
                        Monitor page
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="desktop-card min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-panel">
            <h2 className="text-xl font-extrabold">Monitored domains</h2>
            <div className="mt-4 grid gap-2">
              {summary.profiles.length === 0 ? <EmptyState title="No domains yet" body="Start by adding a competitor, lead, or site you want to watch." /> : null}
              {summary.profiles.map((profile) => {
                const active = activeDomain === profile.domain;
                const content = (
                  <>
                    <span className="flex min-w-0 items-center justify-between gap-2 font-extrabold">
                      <span className="truncate">{profile.domain}</span>
                      {!active && <ChevronRight className="shrink-0" size={16} />}
                      {active && isLoadingDetail ? <LoaderCircle className="shrink-0 animate-spin" size={16} /> : null}
                    </span>
                    <span className={active ? 'text-sm font-semibold text-white/75' : 'text-sm font-semibold text-[#636360]'}>{profile.enabled ? 'Active' : 'Paused'} / {formatPreset(profile.monitoringType)} / {profile.schedule}</span>
                  </>
                );
                return active ? (
                  <div className="grid min-w-0 gap-1 rounded-lg bg-brand-600 p-3 text-left text-white shadow-[0_14px_34px_rgba(59,130,246,0.24)] transition hover:bg-brand-600" key={profile._id}>
                    {content}
                  </div>
                ) : (
                  <button className="grid min-w-0 gap-1 rounded-lg bg-[#f5f5f2] p-3 text-left transition hover:bg-[#efefeb]" key={profile._id} onClick={() => selectDomain(profile.domain)} type="button">
                    {content}
                  </button>
                );
              })}
            </div>
          </section>

          {isLoadingDetail && !domainDetail ? (
            <section className="desktop-card min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-panel">
              <LoadingState title="Loading domain intelligence" rows={4} />
            </section>
          ) : null}

          {domainDetail ? (
            <section className="desktop-card min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-extrabold">{domainDetail.profile.domain}</h2>
                  <p className="mt-1 text-sm font-semibold text-[#636360]">{domainDetail.profile.monitoredPages.length} monitored pages</p>
                </div>
                <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#f5f5f2] px-3 text-sm font-extrabold hover:bg-[#efefeb] disabled:cursor-wait disabled:opacity-65" disabled={isSavingRecommendations || pendingRecommendations(domainDetail.profile).length === 0 || selectedRecommendationUrls.size === 0} onClick={() => acceptRecommendations(domainDetail.profile)} type="button">
                  {isSavingRecommendations ? <LoaderCircle className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
                  {isSavingRecommendations ? 'Saving' : 'Accept'}
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                <PageList title="Recommended" pages={pendingRecommendations(domainDetail.profile)} selectedUrls={selectedRecommendationUrls} onToggle={toggleRecommendation} onDismiss={(url) => dismissRecommendation(domainDetail.profile, url)} />
                <PageList title="Monitoring" pages={domainDetail.profile.monitoredPages} />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ChangeRow({ event, onDomain }: { event: ChangeEvent; onDomain: (domain: string) => void }) {
  return (
    <article className="change-event-card min-w-0 rounded-lg border border-[#eaeae6] bg-[#fbfbf8] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => onDomain(event.domain)} type="button">
          <strong className="block truncate text-base">{formatEvent(event.eventType)}</strong>
          <span className="mt-1 block text-sm font-semibold text-[#636360]">{event.reason || 'Change detected'} / {event.domain}</span>
        </button>
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-extrabold ${event.severity === 'high' ? 'bg-red-50 text-red-700' : event.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-[#efefeb] text-[#636360]'}`}>{event.severity}</span>
      </div>
      <DiffPreview event={event} />
      {event.url ? <a className="mt-3 inline-flex max-w-full items-center gap-2 text-xs font-extrabold text-brand-700" href={event.url} target="_blank" rel="noreferrer"><Eye size={14} /> <span className="truncate">{event.url}</span></a> : null}
    </article>
  );
}

function DiffPreview({ event }: { event: ChangeEvent }) {
  const rows = Object.entries(event.diff || {}).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
  if (event.eventType === 'content_changed' && isHashOnly(event.oldValue) && isHashOnly(event.newValue)) {
    return (
      <div className="change-diff-card mt-3 min-w-0 rounded-md bg-white p-3 text-xs">
        <span className="font-extrabold text-[#636360]">Content fingerprint changed</span>
        <p className="mt-1 font-semibold leading-5 text-[#636360]">This older event only stored a hash fingerprint. Future content changes will show readable before/after excerpts.</p>
      </div>
    );
  }
  if (rows.length === 0 && !event.oldValue && !event.newValue) return null;
  return (
    <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-xs max-[640px]:grid-cols-1">
      <div className="change-diff-card min-w-0 rounded-md bg-white p-3"><span className="font-extrabold text-[#636360]">Before</span><pre className="mt-1 whitespace-pre-wrap break-words font-sans font-semibold">{formatValue(event.oldValue)}</pre></div>
      <div className="change-diff-card min-w-0 rounded-md bg-white p-3"><span className="font-extrabold text-[#636360]">After</span><pre className="mt-1 whitespace-pre-wrap break-words font-sans font-semibold">{formatValue(event.newValue || Object.fromEntries(rows))}</pre></div>
    </div>
  );
}

function PageList({ title, pages, selectedUrls, onToggle, onDismiss }: { title: string; pages: MonitoringProfile['recommendedPages']; selectedUrls?: Set<string>; onToggle?: (url: string) => void; onDismiss?: (url: string) => void }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">{title}</h3>
      <div className="grid min-w-0 gap-2">
        {pages.length === 0 ? <p className="min-w-0 rounded-lg bg-[#f5f5f2] p-3 text-sm font-semibold text-[#636360]">{title === 'Recommended' ? 'No pending recommendations.' : 'No pages yet.'}</p> : null}
        {pages.slice(0, 6).map((page) => {
          const selected = selectedUrls?.has(page.url) ?? false;
          const interactive = Boolean(onToggle);
          const content = (
            <>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                  {interactive ? <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${selected ? 'border-brand-500 bg-brand-600 text-white' : 'border-[#c8c8c2] bg-white text-transparent'}`}><Check size={14} /></span> : null}
                  <strong className="min-w-0 truncate">{page.label}</strong>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs font-extrabold text-brand-700">{page.score}</span>
                  {onDismiss ? (
                    <span
                      className="grid h-7 w-7 place-items-center rounded-md text-[#636360] transition hover:bg-white hover:text-[#111110]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDismiss(page.url);
                      }}
                      role="button"
                      tabIndex={0}
                      title="Dismiss recommendation"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          onDismiss(page.url);
                        }
                      }}
                    >
                      <X size={14} />
                    </span>
                  ) : null}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs font-semibold text-[#636360]">{page.reason}</p>
            </>
          );
          return interactive ? (
            <button className={`w-full min-w-0 rounded-lg p-3 text-left transition ${selected ? 'bg-[#ebf2ff] ring-1 ring-brand-100' : 'bg-[#f5f5f2] hover:bg-[#efefeb]'}`} key={page.url} onClick={() => onToggle?.(page.url)} type="button">
              {content}
            </button>
          ) : (
            <div className="min-w-0 rounded-lg bg-[#f5f5f2] p-3" key={page.url}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: number }) {
  return (
    <section className="desktop-card min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 shadow-panel">
      <div className="mb-5 flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-bold text-[#636360]">{label}</span><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Icon size={18} /></span></div>
      <strong className="text-4xl font-extrabold">{value}</strong>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="min-w-0 rounded-lg bg-[#f5f5f2] p-4"><strong>{title}</strong><p className="mt-1 break-words text-sm font-semibold text-[#636360]">{body}</p></div>;
}

function pendingRecommendations(profile: MonitoringProfile) {
  const monitoredUrls = new Set(profile.monitoredPages.map((page) => page.url));
  return profile.recommendedPages.filter((page) => !monitoredUrls.has(page.url));
}

function groupEvents(events: ChangeEvent[]) {
  const groups = new Map<string, ChangeEvent[]>();
  for (const event of events) {
    const key = relativeDay(new Date(event.detectedAt));
    groups.set(key, [...(groups.get(key) || []), event]);
  }
  return [...groups.entries()];
}

function relativeDay(date: Date) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  if (date.toDateString() === today) return 'Today';
  if (date.toDateString() === yesterday) return 'Yesterday';
  return date.toLocaleDateString();
}

function formatEvent(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPreset(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: unknown) {
  if (!value) return 'No previous value';
  if (isHashOnly(value)) return 'Content fingerprint changed. No readable snapshot was stored for this older event.';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function isHashOnly(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 1 && keys[0] === 'hash';
}
