import { useMemo } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMetrics } from '../hooks/useMetrics.js';
import { useLiveRefresh } from '../hooks/useSocket.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { DataTable } from '../components/ui/DataTable.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { MetricCard } from '../components/ui/MetricCard.jsx';
import { SkeletonGrid, SkeletonPanel } from '../components/ui/Skeleton.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { TimeSeriesChart } from '../components/ui/TimeSeriesChart.jsx';

export function Crawling() {
  const { range } = useTimeRange();
  const queues = useMetrics<any[]>('queues', range);
  const domains = useMetrics<any[]>('domains', range);
  useLiveRefresh(['crawling'], ['domains:live', 'metrics:live'], () => {
    queues.refetch();
    domains.refetch();
  });
  const latest = queues.data?.[queues.data.length - 1] || {};
  const chartData = useMemo(() => (queues.data || []).map((item) => ({ timestamp: item.timestamp, active_page_jobs: item.crawl_breakdown?.active_page_jobs || item.crawl_queue?.active || 0, running_crawls: item.crawl_breakdown?.running_crawls || 0, queued_crawls: item.crawl_breakdown?.queued_crawls || 0, worker_concurrency: item.crawl_breakdown?.worker_concurrency || 0, retrying: (item.retry_queue?.waiting || 0) + (item.retry_queue?.delayed || 0), failed: item.crawl_queue?.failed || 0, dead_letter: item.dead_letter_queue?.count || 0, growth: item.backlog_growth_rate_per_min || 0 })), [queues.data]);
  return (
    <div className="admin-page">
      <ErrorNotice error={queues.error || domains.error} stale={queues.stale || domains.stale} onRetry={() => { queues.refetch(); domains.refetch(); }} />
      {queues.loading && !queues.data ? <SkeletonGrid count={4} columns="admin-grid-four" /> : <section className="admin-grid-four">
        <MetricCard title="Active Page Jobs" value={latest.crawl_breakdown?.active_page_jobs || latest.crawl_queue?.active || 0} unit="page jobs" />
        <MetricCard title="Running Crawls" value={latest.crawl_breakdown?.running_crawls || 0} unit="crawls" />
        <MetricCard title="Queued Crawls" value={latest.crawl_breakdown?.queued_crawls || 0} unit="crawls" trend={(latest.backlog_growth_rate_per_min || 0) > 0 ? 'up' : 'stable'} />
        <MetricCard title="Worker Concurrency" value={latest.crawl_breakdown?.worker_concurrency || 0} unit="max page jobs" />
      </section>}
      <section className="grid gap-4 xl:grid-cols-2">
        {queues.loading && !queues.data ? <><SkeletonPanel /><SkeletonPanel /></> : <><article className="admin-card"><h2>Crawl Workload</h2><TimeSeriesChart data={chartData} lines={[{ key: 'active_page_jobs', color: 'var(--accent-primary)', label: 'Active Page Jobs' }, { key: 'running_crawls', color: 'var(--accent-success)', label: 'Running Crawls' }, { key: 'queued_crawls', color: 'var(--accent-info)', label: 'Queued Crawls' }, { key: 'worker_concurrency', color: 'var(--accent-warning)', label: 'Worker Concurrency' }]} /></article>
        <article className="admin-card"><h2>Backlog Growth Rate</h2><TimeSeriesChart data={chartData} lines={[{ key: 'growth', color: 'var(--accent-critical)', label: 'Jobs/min' }]} /></article></>}
      </section>
      {queues.loading && !queues.data ? <SkeletonGrid count={4} /> : <section className="admin-grid-four">
        <MetricCard title="Retrying" value={(latest.retry_queue?.waiting || 0) + (latest.retry_queue?.delayed || 0)} unit="jobs" />
        <MetricCard title="Completed Jobs" value={latest.crawl_queue?.completed || 0} unit="jobs" />
        <MetricCard title="Recent Failures" value={latest.crawl_queue?.failed || 0} unit="5 min" />
        <MetricCard title="Dead Letter" value={latest.dead_letter_queue?.count || 0} unit="jobs" status="critical" />
      </section>}
      {queues.loading && !queues.data ? <SkeletonPanel height={300} /> : <article className="admin-card">
        <h2>Active vs Recent Failures</h2>
        <ResponsiveContainer width="100%" height={220}><BarChart data={chartData}><XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} /><YAxis /><Tooltip /><Bar dataKey="active_page_jobs" fill="var(--accent-success)" /><Bar dataKey="failed" fill="var(--accent-critical)" /></BarChart></ResponsiveContainer>
      </article>}
      {queues.loading && !queues.data ? <SkeletonPanel /> : <article className="admin-card"><h2>Queue Pressure</h2><TimeSeriesChart data={chartData} lines={[{ key: 'active_page_jobs', color: 'var(--accent-primary)', label: 'Active Page Jobs' }, { key: 'retrying', color: 'var(--accent-warning)', label: 'Retrying Jobs' }, { key: 'failed', color: 'var(--accent-critical)', label: 'Recent Failures' }]} /></article>}
      {domains.loading && !domains.data ? <SkeletonPanel height={320} /> : <article className="admin-card">
        <h2>Domain Analytics</h2>
        <DataTable data={domains.data || []} defaultSortKey="failed_count" columns={[
          { key: 'domain', label: 'Domain' },
          { key: 'pages_crawled', label: 'Pages' },
          { key: 'success_rate_percent', label: 'Success %', render: (row) => formatPercent(row.success_rate_percent) },
          { key: 'block_rate_percent', label: 'Block %', render: (row) => coloredRate(row.block_rate_percent) },
          { key: 'captcha_rate_percent', label: 'Captcha %', render: (row) => coloredRate(row.captcha_rate_percent) },
          { key: 'avg_response_time_ms', label: 'Avg Response', render: (row) => row.avg_response_time_ms == null ? <span className="text-[var(--admin-text-secondary)]">No data</span> : <span className="font-mono">{Number(row.avg_response_time_ms).toFixed(0)}ms</span> },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={domainStatus(row)} pulse /> }
        ]} />
      </article>}
    </div>
  );
}

function domainStatus(row: Record<string, unknown>) {
  const samples = Number(row.sample_count || row.pages_crawled || 0);
  if (samples <= 0) return 'No data';
  const blockRate = Number(row.block_rate_percent || 0);
  return blockRate > 35 ? 'Critical' : blockRate > 15 ? 'Warning' : 'Healthy';
}

function formatPercent(value: unknown) {
  if (value == null) return <span className="text-[var(--admin-text-secondary)]">No data</span>;
  return <span className="font-mono">{Number(value).toFixed(1)}%</span>;
}

function coloredRate(value: unknown) {
  if (value == null) return <span className="text-[var(--admin-text-secondary)]">No data</span>;
  const numeric = Number(value);
  const color = numeric >= 35 ? 'var(--accent-critical)' : numeric >= 15 ? 'var(--accent-warning)' : 'var(--accent-success)';
  return <span className="font-mono" style={{ color }}>{numeric.toFixed(1)}%</span>;
}
