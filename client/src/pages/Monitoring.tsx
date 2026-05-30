import { AlertTriangle, Bell, CheckCircle2, Clock3, ExternalLink, Globe2, Mail, Radio } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CopyButton } from '../components/CopyButton.jsx';
import { CrawlStatusBadge } from '../components/CrawlStatusBadge.jsx';
import { LoadingState } from '../components/LoadingState.jsx';
import type { AlertEvent, MonitoringSummary } from '../types.js';

export function Monitoring() {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.getMonitoring()
        .then((data) => {
          if (!cancelled) setSummary(data);
        })
        .catch(console.error)
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedAlerts = useMemo(() => {
    const groups = new Map<string, NonNullable<MonitoringSummary['recentAlerts']>>();
    for (const alert of dedupeAlerts(summary?.recentAlerts || [])) {
      const key = alert.domain || alert.type;
      groups.set(key, [...(groups.get(key) || []), alert]);
    }
    return [...groups.entries()];
  }, [summary]);

  return (
    <div className="grid gap-6">
      <header>
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Monitoring</span>
        <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Intelligence monitoring</h1>
        <p className="mt-2 text-[16px] text-[#636360]">Important changes, unusual behavior, and active crawl telemetry in one quiet feed.</p>
      </header>

      {isLoading || !summary ? <LoadingState title="Loading monitoring feed" rows={6} /> : (
        <>
          <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            <HealthCard icon={Radio} label="Active crawls" value={summary.health.activeCrawls} tone="green" />
            <HealthCard icon={Globe2} label="Indexed domains" value={summary.health.monitoredDomains} tone="neutral" />
            <HealthCard icon={AlertTriangle} label="Failed crawls 24h" value={summary.health.failedCrawls24h} tone={summary.health.failedCrawls24h ? 'amber' : 'neutral'} />
          </div>

          <div className="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-5 max-[1100px]:grid-cols-1">
            <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-extrabold">Active crawls</h2>
                  <p className="mt-1 text-sm font-semibold text-[#636360]">Rows update automatically.</p>
                </div>
                <Clock3 className="text-brand-600" size={22} />
              </div>
              <div className="grid gap-3">
                {summary.activeCrawls.length === 0 ? (
                  <p className="rounded-lg bg-[#f5f5f2] p-4 text-sm font-semibold text-[#636360]">No active crawls right now. Start a crawl when you want this feed to become live telemetry.</p>
                ) : null}
                {summary.activeCrawls.map((job) => (
                  <Link className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4 transition hover:bg-[#efefeb]" key={job._id} to={`/crawls/${job._id}`}>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <strong className="truncate text-lg">{job.seedUrl}</strong>
                      <CrawlStatusBadge status={job.status} />
                    </div>
                    <span className="text-sm font-semibold text-[#636360]">{job.pagesCrawled} pages / {job.emailsFound} emails / {job.socialLinksFound} socials</span>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-extrabold">Grouped alerts</h2>
                  <p className="mt-1 text-sm font-semibold text-[#636360]">Recent events without noisy repetition.</p>
                </div>
                <Bell className="text-brand-600" size={22} />
              </div>
              <div className="grid max-h-[62vh] gap-3 overflow-y-auto pr-1">
                {groupedAlerts.length === 0 ? (
                  <p className="rounded-lg bg-[#f5f5f2] p-4 text-sm font-semibold text-[#636360]">No important alerts yet. Change, contact, and crawl failure events will group here automatically.</p>
                ) : null}
                {groupedAlerts.map(([group, alerts]) => (
                  <details className="rounded-lg bg-[#f5f5f2] p-4" key={group} open>
                    <summary className="cursor-pointer list-none text-base font-extrabold">{group} <span className="text-sm text-[#636360]">({alerts.length})</span></summary>
                    <div className="mt-3 grid gap-2">
                      {alerts.map((alert) => (
                        <div className="rounded-lg bg-white p-3 text-sm" key={alert._id}>
                          <div className="flex items-center gap-2 font-bold"><CheckCircle2 className={alert.severity === 'high' ? 'text-red-600' : alert.severity === 'medium' ? 'text-amber-600' : 'text-brand-600'} size={15} /> {alert.message}</div>
                          <span className="mt-1 block text-xs font-semibold text-[#636360]">{new Date(alert.createdAt).toLocaleString()}</span>
                          <AlertDetails alert={alert} />
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function AlertDetails({ alert }: { alert: AlertEvent }) {
  const emails = extractEmails(alert.metadata);
  const changes = extractChanges(alert.metadata);
  const hasDetails = emails.length > 0 || changes.length > 0 || alert.pageUrl || alert.crawlId;
  if (!hasDetails) return null;

  return (
    <div className="mt-3 grid gap-3 rounded-md border border-[#eaeae6] bg-[#fbfbf8] p-3">
      {emails.length > 0 ? (
        <div className="grid gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-red-700"><Mail size={13} /> Emails</span>
          <div className="flex flex-wrap gap-2">
            {emails.map((email) => (
              <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-white py-1.5 pl-3 pr-1.5 font-semibold text-[#111110]" key={email}>
                <span className="min-w-0 break-words">{email}</span>
                <CopyButton value={email} label="Copy email" />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {changes.length > 0 ? (
        <div className="grid gap-2">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-amber-700">Changes</span>
          {changes.map((change, index) => (
            <div className="rounded-md bg-white p-3" key={`${change.type}-${index}`}>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{formatChangeType(change.type)}</strong>
                <span className="rounded-full bg-[#efefeb] px-2 py-0.5 text-xs font-extrabold text-[#636360]">{change.severity || 'low'}</span>
              </div>
              <ChangeData data={change.data} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {alert.pageUrl ? (
          <a className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-md border border-[#c8c8c2] bg-white px-3 text-xs font-extrabold text-[#636360] transition hover:border-brand-300 hover:text-brand-800" href={alert.pageUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> <span className="truncate">Open source page</span>
          </a>
        ) : null}
        {alert.crawlId ? (
          <Link className="inline-flex min-h-9 items-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-extrabold text-white transition hover:bg-brand-700" to={`/crawls/${alert.crawlId}`}>
            Open crawl
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function ChangeData({ data }: { data?: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) return null;

  const emails = Array.isArray(data.emails) ? data.emails.map(String) : [];
  if (emails.length > 0) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {emails.map((email) => (
          <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-[#f5f5f2] py-1.5 pl-3 pr-1.5 text-xs font-semibold text-[#111110]" key={email}>
            <span className="min-w-0 break-words">{email}</span>
            <CopyButton value={email} label="Copy email" />
          </span>
        ))}
      </div>
    );
  }

  const rows = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (rows.length === 0) return null;

  return (
    <dl className="mt-2 grid gap-1 text-xs">
      {rows.map(([key, value]) => (
        <div className="grid gap-1 rounded bg-[#f5f5f2] p-2" key={key}>
          <dt className="font-extrabold uppercase tracking-[0.08em] text-[#636360]">{key}</dt>
          <dd className="break-words font-semibold text-[#111110]">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function extractEmails(metadata?: Record<string, unknown>) {
  const emails = metadata?.emails;
  return Array.isArray(emails) ? [...new Set(emails.map(String).filter(Boolean))] : [];
}

function extractChanges(metadata?: Record<string, unknown>) {
  const changes = metadata?.changes;
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((change): change is ChangeAlertItem => Boolean(change) && typeof change === 'object')
    .map((change) => ({
      type: String(change.type || 'change'),
      severity: typeof change.severity === 'string' ? change.severity : undefined,
      data: change.data && typeof change.data === 'object' ? change.data as Record<string, unknown> : undefined
    }));
}

function formatChangeType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

interface ChangeAlertItem {
  type?: unknown;
  severity?: unknown;
  data?: unknown;
}

function dedupeAlerts(alerts: MonitoringSummary['recentAlerts']) {
  const seen = new Set<string>();
  const output: MonitoringSummary['recentAlerts'] = [];

  for (const alert of alerts) {
    const keys = alertDedupeKeys(alert);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    output.push(alert);
  }

  return output;
}

function alertDedupeKeys(alert: MonitoringSummary['recentAlerts'][number]) {
  const day = new Date(alert.createdAt).toLocaleDateString();
  const metadata = alert.metadata || {};
  const emails = Array.isArray(metadata.emails) ? metadata.emails.map(String) : [];
  if (alert.type === 'new_email' && emails.length > 0) {
    return emails.map((email) => `email:${day}:${email.toLowerCase()}`);
  }

  const socials = extractSocialValues(metadata);
  if (socials.length > 0) {
    return socials.map((social) => `social:${day}:${social.toLowerCase()}`);
  }

  return [`alert:${alert.type}:${day}:${alert.domain || ''}:${alert.message}`];
}

function extractSocialValues(metadata: Record<string, unknown>) {
  const candidates = [metadata.social, metadata.socials, metadata.profiles];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    if (Array.isArray(candidate)) return candidate.map(String);
    return Object.values(candidate as Record<string, unknown>).flatMap((value) => {
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === 'string') return [value];
      return [];
    });
  });
}

function HealthCard({ icon: Icon, label, value, tone }: { icon: typeof Radio; label: string; value: number; tone: 'green' | 'amber' | 'neutral' }) {
  const toneClass = tone === 'green' ? 'bg-[#ebf2ff] text-brand-700' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-[#efefeb] text-[#636360]';
  return (
    <section className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-[#636360]">{label}</span>
        <span className={`grid h-10 w-10 place-items-center rounded-full ${toneClass}`}><Icon size={18} /></span>
      </div>
      <strong className="text-4xl font-extrabold">{value}</strong>
    </section>
  );
}
