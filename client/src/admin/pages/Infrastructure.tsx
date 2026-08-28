import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMetrics } from '../hooks/useMetrics.js';
import { useLiveRefresh } from '../hooks/useSocket.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { formatBytes, formatNumber } from '../utils/formatters.js';
import { DataTable } from '../components/ui/DataTable.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { MetricCard } from '../components/ui/MetricCard.jsx';
import { PercentileTable } from '../components/ui/PercentileTable.jsx';
import { SkeletonGrid, SkeletonPanel } from '../components/ui/Skeleton.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { TimeSeriesChart } from '../components/ui/TimeSeriesChart.jsx';

const tabs = ['api', 'workers', 'redis', 'mongodb', 'proxy_pool'] as const;

export function Infrastructure() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = parseTab(searchParams.get('tab'));
  const [tab, setTabState] = useState<typeof tabs[number]>(initialTab);
  const { range } = useTimeRange();
  const infra = useMetrics<any>('infrastructure', range);
  const workers = useMetrics<any>('workers', range);
  const mongoOperations = useMetrics<any[]>('mongo-operations', range);
  const percentiles = useMetrics<any[]>(`percentiles?service=${tab === 'proxy_pool' ? 'api' : tab}`, range);
  useLiveRefresh(['infrastructure'], ['workers:live', 'system:health'], () => {
    infra.refetch();
    workers.refetch();
    mongoOperations.refetch();
    percentiles.refetch();
  });
  const latest = infra.data?.latest;
  const serverInstances = infra.data?.server_instances || [];
  const series = useMemo(() => (infra.data?.series || []).map((item: any) => ({ timestamp: item.timestamp, cpu: item.api?.cpu || item['api.cpu'] || 0, memory: item.api?.memory || item['api.memory'] || 0, latency: item.api?.latency_p95 || item['api.latency_p95'] || 0, redis: item.redis?.memory_used || item['redis.memory_used'] || 0, mongo: item.mongodb?.latency_p95 || item['mongodb.latency_p95'] || 0, proxy: item.proxy_pool?.success_rate || item['proxy_pool.success_rate'] || 0 })), [infra.data]);
  useEffect(() => {
    setTabState(parseTab(searchParams.get('tab')));
  }, [searchParams]);
  return (
    <div className="admin-page">
      <ErrorNotice error={infra.error || workers.error || mongoOperations.error || percentiles.error} stale={infra.stale || workers.stale || mongoOperations.stale || percentiles.stale} onRetry={() => { infra.refetch(); workers.refetch(); mongoOperations.refetch(); percentiles.refetch(); }} />
      <div className="admin-tabs">{tabs.map((item) => <button key={item} type="button" className={tab === item ? 'admin-tab-active' : ''} onClick={() => setTab(item)}>{item.replace('_', ' ')}</button>)}</div>
      {infra.loading && !infra.data ? <><SkeletonGrid count={4} /><SkeletonPanel /></> : (
        <>
          {tab === 'api' ? <Panel title="API Service" cards={[['CPU', latest?.api?.cpu, '%'], ['Memory', latest?.api?.memory, '% RSS'], ['Network In', formatBytes(latest?.api?.network_in), '/s'], ['Latency P95', latest?.api?.latency_p95, 'ms'], ['Observed Requests/sec', latest?.api?.requests_per_sec, 'req/s']]} chart={<TimeSeriesChart data={series} lines={[{ key: 'latency', color: 'var(--accent-primary)', label: 'Latency P95' }, { key: 'cpu', color: 'var(--accent-warning)', label: 'CPU' }, { key: 'memory', color: 'var(--accent-success)', label: 'Memory %' }]} />} /> : null}
          {tab === 'api' ? <article className="admin-card"><h2>API Instance Load</h2><DataTable data={serverInstances} defaultSortKey="instance_id" columns={[
            { key: 'instance_id', label: 'Server' },
        { key: 'status', label: 'Heartbeat', render: (row) => <StatusBadge status={String(row.status)} pulse={String(row.status).toLowerCase() !== 'active'} /> },
            { key: 'api.requests_per_sec', label: 'Req/s', render: (row) => formatNumber((row as any).api?.requests_per_sec) },
            { key: 'api.cpu', label: 'CPU %', render: (row) => formatNumber((row as any).api?.cpu) },
            { key: 'api.memory', label: 'RSS %', render: (row) => formatNumber((row as any).api?.memory) },
            { key: 'api.latency_p95', label: 'P95 ms', render: (row) => formatNumber((row as any).api?.latency_p95) },
            { key: 'hostname', label: 'Host' }
          ]} /></article> : null}
          {tab === 'workers' ? workers.loading && !workers.data ? <><SkeletonGrid count={4} /><SkeletonPanel /><SkeletonPanel height={260} /></> : <WorkerPanel latest={latest} workers={workers.data?.latest || []} series={workers.data?.series || []} /> : null}
          {tab === 'redis' ? <Panel title="Redis" cards={[['Memory Used', formatBytes(latest?.redis?.memory_used), 'used'], ['Commands/sec', latest?.redis?.commands_per_sec, 'cmd/s'], ['Latency', latest?.redis?.latency_ms, 'ms'], ['Clients', latest?.redis?.connected_clients, 'clients']]} chart={<TimeSeriesChart data={series} lines={[{ key: 'redis', color: 'var(--accent-info)', label: 'Memory Used' }]} />} /> : null}
          {tab === 'mongodb' ? <Panel title="MongoDB" cards={[
            ['Queries/sec', latest?.mongodb?.queries_per_sec, 'q/s'],
            ['Latency P95', latest?.mongodb?.latency_p95, 'ms'],
            ['Connections', latest?.mongodb?.connections_active, 'active'],
            ['Data Size', mongoStorageUsedValue(latest), mongoStorageUnit(latest), mongoStorageTrend(latest)]
          ]} chart={<TimeSeriesChart data={series} lines={[{ key: 'mongo', color: 'var(--accent-warning)', label: 'Latency P95' }]} />} /> : null}
          {tab === 'mongodb' ? mongoOperations.loading && !mongoOperations.data ? <SkeletonPanel height={220} /> : <article className="admin-card"><h2>Slow Mongo Operations</h2><DataTable data={mongoOperations.data || []} defaultSortKey="p95Ms" pageSize={8} columns={[
            { key: 'operation', label: 'Operation' },
            { key: 'collection', label: 'Collection' },
            { key: 'p95Ms', label: 'P95 ms' },
            { key: 'avgMs', label: 'Avg ms' },
            { key: 'latestMs', label: 'Latest ms' },
            { key: 'samples', label: 'Samples' },
            { key: 'lastSeenAt', label: 'Last Seen', render: (row) => formatDateTime(row.lastSeenAt) }
          ]} /></article> : null}
          {tab === 'proxy_pool' ? <Panel title="Proxy Pool" cards={[
            ['Total Proxies', latest?.proxy_pool?.total_proxies, 'proxies'],
            ['Active', latest?.proxy_pool?.active_proxies, 'proxies'],
            ['Observed Success', proxyMetricValue(latest, 'success'), proxyMetricUnit(latest, '%')],
            ['Avg Response', proxyMetricValue(latest, 'response'), proxyMetricUnit(latest, 'ms')]
          ]} chart={<TimeSeriesChart data={series} lines={[{ key: 'proxy', color: 'var(--accent-success)', label: 'Success Rate' }]} yDomain={[0, 100]} />} /> : null}
        </>
      )}
      {percentiles.loading && !percentiles.data ? <SkeletonPanel height={160} /> : <article className="admin-card"><h2>Percentile Analytics</h2><PercentileTable data={percentiles.data || []} /></article>}
    </div>
  );

  function setTab(value: typeof tabs[number]) {
    setTabState(value);
    setSearchParams({ tab: value });
  }
}

function parseTab(value: string | null): typeof tabs[number] {
  return tabs.includes(value as typeof tabs[number]) ? value as typeof tabs[number] : 'api';
}

function Panel({ title, cards, chart }: { title: string; cards: Array<[string, unknown, string, string?]>; chart: React.ReactNode }) {
  return <><section className="admin-grid-four">{cards.map(([title, value, unit, trendValue]) => <MetricCard key={title} title={title} value={typeof value === 'string' ? value : formatNumber(value)} unit={unit} trendValue={trendValue} />)}</section><article className="admin-card"><h2>{title}</h2>{chart}</article></>;
}

function mongoStorageUsedValue(latest: any) {
  const usedMb = Number(latest?.mongodb?.storage_used_mb || 0);
  if (usedMb) return `${formatNumber(usedMb)} MB`;
  const usedGb = Number(latest?.mongodb?.storage_used_gb || 0);
  return usedGb ? `${formatNumber(usedGb * 1024)} MB` : '0 MB';
}

function mongoStorageUnit(latest: any) {
  const totalMb = Number(latest?.mongodb?.storage_total_mb || 0);
  if (totalMb) return `/ ${formatNumber(totalMb)} MB`;
  const totalGb = Number(latest?.mongodb?.storage_total_gb || 0);
  return totalGb ? `/ ${formatNumber(totalGb * 1024)} MB` : '/ limit unavailable';
}

function mongoStorageTrend(latest: any) {
  const freeMb = Number(latest?.mongodb?.storage_free_mb || 0);
  const usedPercent = Number(latest?.mongodb?.storage_used_percent || 0);
  const logicalMb = Number(latest?.mongodb?.logical_data_mb || 0);
  const logicalGb = Number(latest?.mongodb?.logical_data_gb || 0);
  const logical = logicalMb ? `${formatNumber(logicalMb)} MB logical` : logicalGb ? `${formatNumber(logicalGb * 1024)} MB logical` : '0 MB logical';
  if (!freeMb && !usedPercent) return 'usage unavailable';
  return `${logical}, ${formatNumber(freeMb)} MB free, ${formatNumber(usedPercent)}% used`;
}

function formatDateTime(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function proxyMetricValue(latest: any, field: 'success' | 'response') {
  const totalProxies = Number(latest?.proxy_pool?.total_proxies || 0);
  const requests = Number(latest?.proxy_pool?.requests_total || 0);
  if (totalProxies === 0 || requests === 0) return 'N/A';
  return field === 'success' ? latest?.proxy_pool?.success_rate : latest?.proxy_pool?.avg_response_time_ms;
}

function proxyMetricUnit(latest: any, unit: string) {
  const totalProxies = Number(latest?.proxy_pool?.total_proxies || 0);
  const requests = Number(latest?.proxy_pool?.requests_total || 0);
  return totalProxies === 0 || requests === 0 ? 'no samples' : unit;
}

function WorkerPanel({ latest, workers, series }: { latest: any; workers: any[]; series: any[] }) {
  return (
    <>
      <section className="admin-grid-four">
        <MetricCard title="Observed Workers" value={latest?.workers?.total || workers.length} />
        <MetricCard title="Active" value={latest?.workers?.active || 0} />
        <MetricCard title="Idle" value={latest?.workers?.idle || 0} />
        <MetricCard title="Crashed" value={latest?.workers?.crashed || 0} status="critical" />
      </section>
      <article className="admin-card"><h2>Worker Cluster</h2><TimeSeriesChart data={series} lines={[{ key: 'cpu_percent', color: 'var(--accent-primary)', label: 'CPU' }, { key: 'memory_mb', color: 'var(--accent-success)', label: 'Memory MB' }, { key: 'pages_per_sec', color: 'var(--accent-warning)', label: 'Pages/sec' }]} /></article>
      <article className="admin-card"><h2>Worker Load</h2><DataTable data={workers} columns={[
        { key: 'worker_id', label: 'Worker ID' },
        { key: 'worker_type', label: 'Type' },
        { key: 'queue_name', label: 'Queue' },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge status={String(row.status)} pulse={String(row.status).toLowerCase() === 'active'} /> },
        { key: 'jobs_running', label: 'Running' },
        { key: 'jobs_completed_total', label: 'Completed' },
        { key: 'jobs_failed_total', label: 'Failures' },
        { key: 'pages_per_sec', label: 'Pages/sec' },
        { key: 'cpu_percent', label: 'CPU %' },
        { key: 'memory_mb', label: 'Memory MB' },
        { key: 'hostname', label: 'Host' }
      ]} /></article>
    </>
  );
}
