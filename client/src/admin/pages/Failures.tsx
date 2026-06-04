import { useMemo, useState } from 'react';
import { AlertTriangle, Database, Globe, Timer } from 'lucide-react';
import { useMetrics } from '../hooks/useMetrics.js';
import { useLiveRefresh } from '../hooks/useSocket.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import type { TimeRange } from '../context/AdminContext.jsx';
import { BottleneckBar } from '../components/ui/BottleneckBar.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { MetricCard } from '../components/ui/MetricCard.jsx';
import { RootCauseCard } from '../components/ui/RootCauseCard.jsx';
import { SkeletonGrid, SkeletonPanel } from '../components/ui/Skeleton.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { TimeSeriesChart } from '../components/ui/TimeSeriesChart.jsx';

const labels: Record<string, string> = {
  rate_limited_429: '429 Rate Limited',
  forbidden_403: '403 Forbidden',
  captcha: 'Captcha',
  proxy_failure: 'Proxy Failure',
  timeout: 'Timeout',
  dns_failure: 'DNS Failure',
  parser_error: 'Parser Error',
  database_error: 'Database Error',
  network_error: 'Network Error',
  queue_stalled: 'Queue Stalled',
  unknown: 'Unknown'
};

export function Failures() {
  const { range } = useTimeRange();
  const [trendRange, setTrendRange] = useState<TimeRange>(range);
  const failures = useMetrics<any>('failures', trendRange);
  const timeline = useMetrics<any[]>('failures/timeline', range);
  const domains = useMetrics<any[]>('domains', range);
  useLiveRefresh(['failures'], ['failures:live'], () => {
    failures.refetch();
    timeline.refetch();
    domains.refetch();
  });
  const total = (failures.data?.grouped || []).reduce((sum: number, item: any) => sum + item.count, 0);
  const trend = useMemo(() => normalizeTrend(failures.data?.trend || []), [failures.data]);
  return (
    <div className="admin-page">
      <ErrorNotice error={failures.error || timeline.error || domains.error} stale={failures.stale || timeline.stale || domains.stale} onRetry={() => { failures.refetch(); timeline.refetch(); domains.refetch(); }} />
      {failures.loading && !failures.data ? <SkeletonGrid count={9} columns="grid gap-3 md:grid-cols-3 xl:grid-cols-5" /> : <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {(failures.data?.types || Object.keys(labels)).filter((type: string) => type !== 'unknown').map((type: string) => {
          const item = (failures.data?.grouped || []).find((row: any) => row._id === type);
          return <MetricCard key={type} title={labels[type] || type} value={item?.count || 0} unit={`events, ${total ? (((item?.count || 0) / total) * 100).toFixed(1) : 0}%`} trend={(item?.count || 0) > 0 ? 'up' : 'stable'} status={(item?.count || 0) > 10 ? 'critical' : 'warning'} />;
        })}
      </section>}
      {failures.loading && !failures.data ? <SkeletonPanel /> : <article className="admin-card">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2>Failure Trends</h2><div className="admin-tabs compact">{(['1h', '6h', '24h', '7d', '30d'] as TimeRange[]).map((item) => <button key={item} type="button" className={trendRange === item ? 'admin-tab-active' : ''} onClick={() => setTrendRange(item)}>{item}</button>)}</div></div>
        <TimeSeriesChart data={trend} lines={Object.keys(labels).slice(0, 6).map((key, index) => ({ key, label: labels[key], color: ['#00d4ff', '#f59e0b', '#ef4444', '#10b981', '#6366f1', '#e2e8f0'][index] }))} />
      </article>}
      <section className="grid gap-4 xl:grid-cols-[11fr_9fr]">
        {(failures.loading && !failures.data) || (domains.loading && !domains.data) ? <div className="space-y-4"><SkeletonPanel height={220} /><SkeletonPanel height={220} /></div> : <div className="space-y-4">
          <RootCauseCard title="Queue Backlog" cause="Workers Saturated" evidence={[{ metric: 'failures', value: total }, { metric: 'dominant', value: failures.data?.grouped?.[0]?._id || 'none' }]} impact="Crawler throughput and retry latency may degrade while failures remain elevated." severity={total > 50 ? 'Critical' : 'High'} action="Inspect dominant failure type and scale or throttle accordingly." />
          <RootCauseCard title="Target Site Blocks" cause="Block/captcha indicators" evidence={[{ metric: 'domains', value: domains.data?.length || 0 }]} impact="Affected domains may need lower concurrency or request identity rotation." severity="Medium" action="Tune domain-level throttle rules." />
        </div>}
        {domains.loading && !domains.data ? <SkeletonPanel height={260} /> : <article className="admin-card"><h2>Domain Failure Analysis</h2><DataTable data={domains.data || []} defaultSortKey="failed_count" columns={[{ key: 'domain', label: 'Domain' }, { key: 'block_rate_percent', label: 'Block Rate' }, { key: 'captcha_rate_percent', label: 'Captcha Rate' }, { key: 'timeout_count', label: 'Timeouts' }, { key: 'failed_count', label: 'Failures' }]} /></article>}
      </section>
      {timeline.loading && !timeline.data ? <SkeletonPanel height={340} /> : <article className="admin-card">
        <h2>Incident Timeline</h2>
        <div className="admin-timeline">
          {(timeline.data || []).slice(0, 80).map((event) => <div key={event._id} className="admin-timeline-item"><span className="admin-timeline-marker">{iconFor(event.failure_type)}</span><div><time>{new Date(event.timestamp).toLocaleString()}</time><strong>{timelineTitle(event)}</strong><p>{timelineDetail(event)}</p></div><StatusBadge status={event.is_terminal ? 'Critical' : 'Warning'} /></div>)}
        </div>
      </article>}
      {(failures.loading && !failures.data) || (domains.loading && !domains.data) ? <SkeletonPanel height={220} /> : <article className="admin-card"><h2>Bottleneck Ranking</h2><div className="mt-4 space-y-4"><BottleneckBar label="Failure Volume" score={Math.min(100, total)} severity={total > 50 ? 'critical' : 'warning'} /><BottleneckBar label="Domain Blocks" score={Math.max(...(domains.data || [0]).map((item: any) => item.block_rate_percent || 0))} severity="warning" /><BottleneckBar label="Timeouts" score={(failures.data?.grouped || []).find((item: any) => item._id === 'timeout')?.count || 0} severity="warning" /></div></article>}
    </div>
  );
}

function normalizeTrend(rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = new Date(row._id.bucket).toISOString();
    const current = map.get(key) || { timestamp: key };
    current[row._id.type] = row.count;
    map.set(key, current);
  }
  return [...map.values()];
}

function iconFor(type: string) {
  if (type === 'database_error') return <Database size={16} />;
  if (type === 'timeout') return <Timer size={16} />;
  if (type === 'forbidden_403' || type === 'rate_limited_429') return <Globe size={16} />;
  return <AlertTriangle size={16} />;
}

function timelineTitle(event: any) {
  const label = labels[event.failure_type] || event.failure_type || 'Unknown';
  if (event.domain) return `${label}: ${event.domain}`;
  if (event.worker_id) return `${label}: ${event.worker_id}`;
  return label;
}

function timelineDetail(event: any) {
  const parts = [
    event.error_message || event.url_attempted || 'No failure detail recorded',
    event.job_id ? `job ${event.job_id}` : '',
    event.retry_count ? `retry ${event.retry_count}` : ''
  ].filter(Boolean);
  return parts.join(' · ');
}
