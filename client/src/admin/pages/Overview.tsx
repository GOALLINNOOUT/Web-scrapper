import { CheckCircle, CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAdmin } from '../context/AdminContext.jsx';
import { useMetrics } from '../hooks/useMetrics.js';
import { useLiveRefresh } from '../hooks/useSocket.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { formatBytes, formatNumber } from '../utils/formatters.js';
import { BottleneckBar } from '../components/ui/BottleneckBar.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { MetricCard } from '../components/ui/MetricCard.jsx';
import { SkeletonGrid, SkeletonPanel } from '../components/ui/Skeleton.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { TimeSeriesChart } from '../components/ui/TimeSeriesChart.jsx';

export function Overview() {
  const { state } = useAdmin();
  const { range } = useTimeRange();
  const overview = useMetrics<any>('overview', range);
  const system = useMetrics<any[]>('system', range);
  useLiveRefresh(['overview'], ['metrics:live', 'system:health', 'alerts:active', 'alerts:new', 'alerts:resolve'], () => {
    overview.refetch();
    system.refetch();
  });
  const metric = overview.data?.metric;
  const queue = overview.data?.queue;
  const chartData = useMemo(() => (system.data || []).map((item) => ({ timestamp: item.timestamp, cpu: metricValue(item, 'api.cpu'), memory: metricValue(item, 'api.memory'), workers: metricValue(item, 'workers.avg_cpu'), mongo: metricValue(item, 'mongodb.latency_p95') })), [system.data]);
  const crawlStatus = [
    { name: 'Active', value: metric?.system_totals?.active_crawls || 0, color: 'var(--accent-primary)' },
    { name: 'Queued', value: metric?.system_totals?.queued_crawls || 0, color: 'var(--accent-info)' },
    { name: 'Running', value: metric?.system_totals?.running_crawls || 0, color: 'var(--accent-warning)' },
    { name: 'Completed', value: metric?.system_totals?.completed_crawls || 0, color: 'var(--accent-success)' },
    { name: 'Failed', value: metric?.system_totals?.failed_crawls || 0, color: 'var(--accent-critical)' }
  ];
  const visibleCrawlStatus = crawlStatus.filter((item) => item.value > 0);
  const crawlStatusDonutData = visibleCrawlStatus.length ? visibleCrawlStatus : [{ name: 'No crawls', value: 1, color: 'var(--admin-border)' }];
  return (
    <div className="admin-page">
      <ErrorNotice error={overview.error || system.error} stale={overview.stale || system.stale} onRetry={() => { overview.refetch(); system.refetch(); }} />
      {overview.loading && !overview.data ? <SkeletonGrid count={6} columns="admin-grid-six" /> : <section className="admin-grid-six">
        {Object.entries(state.systemHealth).filter(([key]) => key !== 'failures').map(([key, status]) => (
          <article className="admin-card" key={key}>
            <StatusBadge status={status} pulse size="lg" />
            <h3 className="mt-4 capitalize">{key.replace('_', ' ')}</h3>
            <p className="mt-2 font-mono text-xl">{criticalMetric(key, metric, queue)}</p>
          </article>
        ))}
      </section>}
      {overview.loading && !overview.data ? <SkeletonGrid count={4} /> : <section className="admin-grid-four">
        <MetricCard title="Requests/sec" value={formatNumber(metric?.system_totals?.requests_per_sec)} unit="req/s" trend="stable" />
        <MetricCard title="Pages/sec" value={formatNumber(metric?.system_totals?.pages_per_sec)} unit="pages/s" trend="up" />
        <MetricCard title="Jobs/sec" value={formatNumber(metric?.system_totals?.jobs_per_sec)} unit="jobs/s" trend="stable" />
        <MetricCard title="Domains/sec" value={formatNumber(metric?.system_totals?.domains_per_sec)} unit="domains/s" trend="stable" />
      </section>}
      <section className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        {system.loading && !system.data ? <SkeletonPanel /> : <article className="admin-card">
          <h2>Live Resource Usage</h2>
          <TimeSeriesChart data={chartData} lines={[{ key: 'cpu', color: 'var(--accent-primary)', label: 'API CPU' }, { key: 'memory', color: 'var(--accent-success)', label: 'API Memory' }, { key: 'workers', color: 'var(--accent-warning)', label: 'Worker CPU' }]} yDomain={[0, 100]} />
        </article>}
        {overview.loading && !overview.data ? <SkeletonPanel height={260} /> : <article className="admin-card">
          <h2>Active Crawl Status</h2>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Tooltip
                formatter={(value, name) => [Number(value).toLocaleString(), name]}
                filterNull
              />
              <Pie data={crawlStatusDonutData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86}>
                {crawlStatusDonutData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 text-sm">{crawlStatus.map((item) => <span key={item.name} className="flex justify-between"><em className="not-italic text-[var(--admin-text-secondary)]">{item.name}</em><strong className="font-mono">{item.value}</strong></span>)}</div>
        </article>}
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        {overview.loading && !overview.data ? <SkeletonPanel height={220} /> : <article className="admin-card">
          <h2>Active Incidents</h2>
          {state.activeAlerts.length ? state.activeAlerts.slice(0, 5).map((alert) => <div key={alert.alert_id} className="mt-3 rounded border border-[var(--admin-border)] p-3"><StatusBadge status={alert.severity} pulse /><strong className="mt-2 block">{alert.title}</strong><p className="text-sm text-[var(--admin-text-secondary)]">{alert.description}</p></div>) : <p className="mt-4 flex items-center gap-2 text-[var(--accent-success)]"><CheckCircle size={18} /> All systems operational</p>}
        </article>}
        {overview.loading && !overview.data ? <SkeletonPanel height={220} /> : <article className="admin-card">
          <h2>Top Bottlenecks</h2>
          <div className="mt-4 space-y-4">
            <BottleneckBar label="Queue Backlog" score={Math.min(100, queue?.total_backlog || 0)} severity={(queue?.backlog_growth_rate_per_min || 0) > 50 ? 'warning' : 'info'} />
            <BottleneckBar label="Worker CPU" score={metric?.workers?.avg_cpu || 0} severity={(metric?.workers?.avg_cpu || 0) > 85 ? 'warning' : 'info'} />
            <BottleneckBar label="Proxy Health" score={100 - (metric?.proxy_pool?.success_rate || 100)} severity={(metric?.proxy_pool?.success_rate || 100) < 85 ? 'warning' : 'info'} />
            <BottleneckBar label="MongoDB Latency" score={Math.min(100, (metric?.mongodb?.latency_p95 || 0) / 5)} severity={(metric?.mongodb?.latency_p95 || 0) > 200 ? 'warning' : 'info'} />
          </div>
        </article>}
      </section>
    </div>
  );
}

function criticalMetric(key: string, metric: any, queue: any) {
  if (key === 'api') return `${metric?.api?.latency_p95 || 0}ms p95`;
  if (key === 'workers') return `${metric?.workers?.avg_cpu || 0}% CPU`;
  if (key === 'redis') return formatBytes(metric?.redis?.memory_used);
  if (key === 'mongodb') return `${metric?.mongodb?.latency_p95 || 0}ms p95`;
  if (key === 'proxy_pool') return `${metric?.proxy_pool?.success_rate || 100}%`;
  if (key === 'queue') return `${queue?.total_backlog || 0} backlog`;
  return <CircleAlert size={16} />;
}

function metricValue(item: any, path: string) {
  const flattened = item?.[path];
  if (flattened != null) return Number(flattened) || 0;
  return path.split('.').reduce((value, key) => value?.[key], item) || 0;
}
