import { Bell, Globe2, LoaderCircle, Mail, Plus, Radar, Sparkles } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatRelativeTime } from '../lib/format.js';
import { normalizeMonitorDomain } from '../lib/monitorDomain.js';
import { showToast } from '../toast.js';
import type { ChangeEvent, MonitoringProfile, MonitoringSummary } from '../types.js';

export function MobileMonitoring() {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [domain, setDomain] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [monitorError, setMonitorError] = useState('');
  const normalizedDomain = normalizeMonitorDomain(domain);
  const isValidDomain = Boolean(normalizedDomain);

  async function load() {
    setSummary(await api.getMonitoring());
  }

  useEffect(() => {
    load().catch(console.error).finally(() => setIsLoading(false));
  }, []);

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedDomain) return;
    setIsAdding(true);
    setMonitorError('');
    try {
      const result = await api.createMonitoringProfile({ domain: normalizedDomain, monitoringType: 'competitive_intelligence' });
      setDomain('');
      await load();
      showToast({ title: 'Monitoring started', description: result.profile.domain, tone: 'success' });
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : 'This domain cannot be monitored.');
    } finally {
      setIsAdding(false);
    }
  }

  const grouped = useMemo(() => groupBySeverity(summary?.changeFeed || []), [summary]);

  return (
    <div className="mobile-page-enter px-4 pb-6">
      <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-2" onSubmit={addDomain}>
        <input className="h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-sm outline-none" value={domain} onChange={(event) => { setDomain(event.target.value); setMonitorError(''); }} placeholder="Add domain to monitor" />
        <button
          className={`mobile-monitor-submit h-11 ${isValidDomain ? 'mobile-monitor-submit-ready' : ''}`}
          type="submit"
          aria-label={isValidDomain ? `Monitor ${normalizedDomain}` : 'Enter a valid domain to monitor'}
          disabled={isAdding || !isValidDomain}
        >
          {isAdding ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}
          <span>{isAdding ? 'Adding' : isValidDomain ? 'Monitor' : 'Valid domain'}</span>
        </button>
      </form>
      {domain.trim() && !isValidDomain ? <p className="mt-2 px-1 text-xs font-medium text-[var(--danger)]">Enter a domain like example.com.</p> : null}
      {monitorError ? <p className="mt-2 px-1 text-xs font-medium text-[var(--danger)]">{monitorError}</p> : null}

      {isLoading || !summary ? <div className="mt-5 grid gap-2">{[0, 1, 2].map((item) => <span className="mobile-skeleton h-24 rounded-xl" key={item} />)}</div> : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <MiniMetric icon={Sparkles} label="Changes" value={summary.counts.changesToday} />
            <MiniMetric icon={Globe2} label="Domains" value={summary.health.monitoredDomains} />
            <MiniMetric icon={Mail} label="Emails" value={summary.counts.newEmails} />
            <MiniMetric icon={Radar} label="Active" value={summary.health.activeCrawls} />
          </div>

          <h2 className="mobile-section-label !px-0">Alert Feed</h2>
          {grouped.length === 0 ? <div className="rounded-xl bg-[var(--bg-base)] p-8 text-center"><Bell className="mx-auto text-[var(--text-tertiary)]" size={34} /><p className="mt-3 text-sm font-semibold">No alerts yet</p></div> : null}
          <div className="grid gap-4">
            {grouped.map(([severity, events]) => (
              <section key={severity}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{severity}</h3>
                <div className="grid gap-2">
                  {events.map((event) => <AlertCard event={event} key={event._id} />)}
                </div>
              </section>
            ))}
          </div>

          <h2 className="mobile-section-label !px-0">Monitored Domains</h2>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {summary.profiles.map((profile) => <ProfileChip profile={profile} key={profile._id} />)}
          </div>
        </>
      )}
    </div>
  );
}

function MiniMetric({ icon: Icon, label, value }: { icon: typeof Bell; label: string; value: number }) {
  return <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"><div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]"><span>{label}</span><Icon size={16} /></div><strong className="mt-3 block font-mono text-2xl">{value}</strong></div>;
}

function AlertCard({ event }: { event: ChangeEvent }) {
  const color = event.severity === 'high' ? 'border-l-[var(--danger)]' : event.severity === 'medium' ? 'border-l-[var(--warning)]' : 'border-l-[var(--accent)]';
  return <article className={`rounded-xl border border-l-4 border-[var(--border-subtle)] ${color} bg-[var(--bg-base)] p-4`}><div className="flex items-start justify-between gap-3"><strong className="min-w-0 text-sm">{formatEvent(event.eventType)}</strong><span className="shrink-0 text-[11px] font-semibold text-[var(--text-tertiary)]">{formatRelativeTime(event.detectedAt)}</span></div><p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{event.reason || 'Change detected'} · {event.domain}</p></article>;
}

function ProfileChip({ profile }: { profile: MonitoringProfile }) {
  return <span className="shrink-0 rounded-full bg-[var(--bg-base)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]">{profile.domain}</span>;
}

function groupBySeverity(events: ChangeEvent[]) {
  const order = ['high', 'medium', 'low'];
  return order.map((severity) => [severity, events.filter((event) => (event.severity || 'low') === severity)] as [string, ChangeEvent[]]).filter(([, items]) => items.length > 0);
}

function formatEvent(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
