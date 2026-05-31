import { Activity, Bell, BriefcaseBusiness, CheckCircle2, ChevronRight, Eye, Globe2, Mail, Plus, Radar, Search, Sparkles } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { LoadingState } from '../components/LoadingState.jsx';
import { showToast } from '../toast.js';
import type { ChangeEvent, MonitoringProfile, MonitoringSummary } from '../types.js';

const monitorTypes = [
  { value: 'competitive_intelligence', label: 'Competitive Intelligence' },
  { value: 'lead_discovery', label: 'Lead Discovery' },
  { value: 'seo_monitoring', label: 'SEO Monitoring' },
  { value: 'infrastructure_monitoring', label: 'Infrastructure Monitoring' },
  { value: 'custom', label: 'Custom' }
] as const;

export function Monitoring() {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [activeDomain, setActiveDomain] = useState<string>('');
  const [domainDetail, setDomainDetail] = useState<{ profile: MonitoringProfile; events: ChangeEvent[] } | null>(null);
  const [domain, setDomain] = useState('');
  const [monitoringType, setMonitoringType] = useState<MonitoringProfile['monitoringType']>('competitive_intelligence');
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

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
    api.getMonitoringProfile(activeDomain)
      .then((data) => setDomainDetail({ profile: data.profile, events: data.events }))
      .catch(() => setDomainDetail(null));
  }, [activeDomain]);

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!domain.trim()) return;
    setIsAdding(true);
    try {
      const result = await api.createMonitoringProfile({ domain, monitoringType });
      showToast({ title: 'Monitoring started', description: result.profile.domain, tone: 'success' });
      setDomain('');
      setActiveDomain(result.profile.domain);
      await load();
    } finally {
      setIsAdding(false);
    }
  }

  async function acceptRecommendations(profile: MonitoringProfile) {
    const updated = await api.acceptMonitoringRecommendations(profile._id);
    setDomainDetail((current) => current ? { ...current, profile: updated } : current);
    await load();
    showToast({ title: 'Recommendations accepted', description: `${updated.monitoredPages.length} pages are now monitored.`, tone: 'success' });
  }

  const groupedEvents = useMemo(() => groupEvents(summary?.changeFeed || []), [summary]);

  if (isLoading || !summary) return <LoadingState title="Loading intelligence feed" rows={7} />;

  return (
    <div className="grid gap-6">
      <header className="flex items-end justify-between gap-4 max-[900px]:grid">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Monitoring</span>
          <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">What changed since you last looked</h1>
          <p className="mt-2 max-w-3xl text-[16px] text-[#636360]">An intelligence feed for important pages, contacts, technology, DNS, WHOIS, and content shifts.</p>
        </div>
      </header>

      <form className="grid grid-cols-[minmax(220px,1fr)_240px_150px] gap-3 rounded-lg border border-[#eaeae6] bg-white p-4 shadow-panel max-[860px]:grid-cols-1" onSubmit={addDomain}>
        <label className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636360]" size={16} />
          <input className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] pl-10 pr-3 text-sm font-semibold outline-none focus:border-brand-500 focus:bg-white" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="Add domain to monitor, e.g. example.com" />
        </label>
        <select className="h-12 rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-3 text-sm font-bold outline-none focus:border-brand-500 focus:bg-white" value={monitoringType} onChange={(event) => setMonitoringType(event.target.value as MonitoringProfile['monitoringType'])}>
          {monitorTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-extrabold text-white hover:bg-brand-700 disabled:opacity-60" disabled={isAdding} type="submit"><Plus size={16} /> Add</button>
      </form>

      <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
        <MetricCard icon={Sparkles} label="Changes today" value={summary.counts.changesToday} />
        <MetricCard icon={Globe2} label="New pages" value={summary.counts.newPages} />
        <MetricCard icon={Mail} label="New emails" value={summary.counts.newEmails} />
        <MetricCard icon={Radar} label="Monitored domains" value={summary.health.monitoredDomains} />
      </div>

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] gap-5 max-[1180px]:grid-cols-1">
        <section className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
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

        <aside className="grid h-fit gap-5">
          <section className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
            <h2 className="text-xl font-extrabold">Monitored domains</h2>
            <div className="mt-4 grid gap-2">
              {summary.profiles.length === 0 ? <EmptyState title="No domains yet" body="Start by adding a competitor, lead, or site you want to watch." /> : null}
              {summary.profiles.map((profile) => (
                <button className={`grid gap-1 rounded-lg p-3 text-left transition ${activeDomain === profile.domain ? 'bg-brand-600 text-white' : 'bg-[#f5f5f2] hover:bg-[#efefeb]'}`} key={profile._id} onClick={() => setActiveDomain(profile.domain)} type="button">
                  <span className="flex items-center justify-between gap-2 font-extrabold">{profile.domain}<ChevronRight size={16} /></span>
                  <span className={activeDomain === profile.domain ? 'text-sm font-semibold text-white/75' : 'text-sm font-semibold text-[#636360]'}>{profile.enabled ? 'Active' : 'Paused'} / {formatPreset(profile.monitoringType)} / {profile.schedule}</span>
                </button>
              ))}
            </div>
          </section>

          {domainDetail ? (
            <section className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold">{domainDetail.profile.domain}</h2>
                  <p className="mt-1 text-sm font-semibold text-[#636360]">{domainDetail.profile.monitoredPages.length} monitored pages</p>
                </div>
                <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#f5f5f2] px-3 text-sm font-extrabold hover:bg-[#efefeb]" onClick={() => acceptRecommendations(domainDetail.profile)} type="button"><CheckCircle2 size={15} /> Accept</button>
              </div>
              <div className="mt-4 grid gap-3">
                <PageList title="Recommended" pages={domainDetail.profile.recommendedPages} />
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
    <article className="rounded-lg border border-[#eaeae6] bg-[#fbfbf8] p-4">
      <div className="flex items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => onDomain(event.domain)} type="button">
          <strong className="block truncate text-base">{formatEvent(event.eventType)}</strong>
          <span className="mt-1 block text-sm font-semibold text-[#636360]">{event.reason || 'Change detected'} / {event.domain}</span>
        </button>
        <span className={`rounded-md px-2 py-1 text-xs font-extrabold ${event.severity === 'high' ? 'bg-red-50 text-red-700' : event.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-[#efefeb] text-[#636360]'}`}>{event.severity}</span>
      </div>
      <DiffPreview event={event} />
      {event.url ? <a className="mt-3 inline-flex max-w-full items-center gap-2 text-xs font-extrabold text-brand-700" href={event.url} target="_blank" rel="noreferrer"><Eye size={14} /> <span className="truncate">{event.url}</span></a> : null}
    </article>
  );
}

function DiffPreview({ event }: { event: ChangeEvent }) {
  const rows = Object.entries(event.diff || {}).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
  if (rows.length === 0 && !event.oldValue && !event.newValue) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs max-[640px]:grid-cols-1">
      <div className="rounded-md bg-white p-3"><span className="font-extrabold text-[#636360]">Before</span><pre className="mt-1 whitespace-pre-wrap break-words font-sans font-semibold">{formatValue(event.oldValue)}</pre></div>
      <div className="rounded-md bg-white p-3"><span className="font-extrabold text-[#636360]">After</span><pre className="mt-1 whitespace-pre-wrap break-words font-sans font-semibold">{formatValue(event.newValue || Object.fromEntries(rows))}</pre></div>
    </div>
  );
}

function PageList({ title, pages }: { title: string; pages: MonitoringProfile['recommendedPages'] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">{title}</h3>
      <div className="grid gap-2">
        {pages.length === 0 ? <p className="rounded-lg bg-[#f5f5f2] p-3 text-sm font-semibold text-[#636360]">No pages yet.</p> : null}
        {pages.slice(0, 6).map((page) => (
          <div className="rounded-lg bg-[#f5f5f2] p-3" key={page.url}>
            <div className="flex items-center justify-between gap-2"><strong className="truncate">{page.label}</strong><span className="text-xs font-extrabold text-brand-700">{page.score}</span></div>
            <p className="mt-1 line-clamp-2 text-xs font-semibold text-[#636360]">{page.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: number }) {
  return (
    <section className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center justify-between gap-3"><span className="text-sm font-bold text-[#636360]">{label}</span><span className="grid h-10 w-10 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Icon size={18} /></span></div>
      <strong className="text-4xl font-extrabold">{value}</strong>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="rounded-lg bg-[#f5f5f2] p-4"><strong>{title}</strong><p className="mt-1 text-sm font-semibold text-[#636360]">{body}</p></div>;
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
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
