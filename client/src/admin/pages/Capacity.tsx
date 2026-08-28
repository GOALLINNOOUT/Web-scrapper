import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMetrics } from '../hooks/useMetrics.js';
import { useLiveRefresh } from '../hooks/useSocket.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { formatNumber } from '../utils/formatters.js';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { MetricCard } from '../components/ui/MetricCard.jsx';
import { RootCauseCard } from '../components/ui/RootCauseCard.jsx';
import { SkeletonGrid, SkeletonPanel } from '../components/ui/Skeleton.jsx';

export function Capacity() {
  const { range } = useTimeRange();
  const capacity = useMetrics<any[]>('capacity', '30d');
  const costs = useMetrics<any[]>('costs', range);
  useLiveRefresh(['overview'], ['metrics:live'], () => {
    capacity.refetch();
    costs.refetch();
  });
  const costRows = costs.data || [];
  const latestCost = costRows[costRows.length - 1] || {};
  return (
    <div className="admin-page">
      <ErrorNotice error={capacity.error || costs.error} stale={capacity.stale || costs.stale} onRetry={() => { capacity.refetch(); costs.refetch(); }} />
      {capacity.loading && !capacity.data ? <SkeletonGrid count={4} /> : <section className="admin-grid-four">
        {(capacity.data || []).map((item) => <MetricCard key={item.metric} title={item.metric} value={item.days_remaining ?? 'No date'} unit={item.days_remaining ? 'days' : ''} trend={(item.days_remaining || 999) < 30 ? 'up' : 'stable'} trendValue={`${formatNumber(item.growth_rate_per_day)} ${item.metric === 'MongoDB Storage' ? 'MB' : 'units'} / day`} status={(item.days_remaining || 999) < 14 ? 'critical' : 'warning'} />)}
      </section>}
      {capacity.loading && !capacity.data ? <SkeletonPanel /> : <article className="admin-card"><h2>Growth Analytics</h2><ResponsiveContainer width="100%" height={280}><BarChart data={capacity.data || []}><CartesianGrid stroke="rgba(226,232,240,0.10)" vertical={false} /><XAxis dataKey="metric" /><YAxis /><Tooltip /><Bar dataKey="current_value" fill="var(--accent-primary)" /><Bar dataKey="growth_rate_per_day" fill="var(--accent-warning)" /></BarChart></ResponsiveContainer></article>}
      {costs.loading && !costs.data ? <SkeletonGrid count={4} /> : <section className="admin-grid-four">
        <MetricCard title="External Daily Cost" value={formatNumber(latestCost.total_daily_usd)} unit="USD" />
        <MetricCard title="External Weekly Cost" value={formatNumber(latestCost.total_weekly_usd)} unit="USD" />
        <MetricCard title="External Monthly Projection" value={formatNumber(latestCost.total_monthly_usd_projected)} unit="USD" />
        <MetricCard title="External Cost Rows" value={costRows.length} />
      </section>}
      {costs.loading && !costs.data ? <SkeletonPanel /> : <article className="admin-card"><h2>Cost Breakdown</h2><ResponsiveContainer width="100%" height={260}><BarChart data={costRows}><XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString()} /><YAxis /><Tooltip /><Bar dataKey="servers_usd" stackId="a" fill="var(--accent-primary)" /><Bar dataKey="workers_usd" stackId="a" fill="var(--accent-warning)" /><Bar dataKey="storage_usd" stackId="a" fill="var(--accent-info)" /><Bar dataKey="proxies_usd" stackId="a" fill="var(--accent-critical)" /></BarChart></ResponsiveContainer></article>}
      {capacity.loading && !capacity.data ? <SkeletonGrid count={3} columns="grid gap-4 xl:grid-cols-3" height={220} /> : <section className="grid gap-4 xl:grid-cols-3">
        {(capacity.data || []).slice(0, 3).map((item) => <RootCauseCard key={item.metric} title={`Scale ${item.metric}`} cause={`${item.metric} growth forecast`} evidence={[{ metric: 'current', value: item.current_value }, { metric: 'growth/day', value: item.growth_rate_per_day }]} impact={item.days_remaining ? `${item.metric} may saturate in ${item.days_remaining} days.` : 'No near-term saturation detected.'} severity={(item.days_remaining || 999) < 14 ? 'Immediate' : (item.days_remaining || 999) < 30 ? 'Soon' : 'Plan'} action="Review capacity and cost impact before the next growth window." />)}
      </section>}
    </div>
  );
}
