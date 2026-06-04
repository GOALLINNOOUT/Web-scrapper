import { Activity, ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export function MetricCard({ title, value, unit, trend, trendValue, status, sparklineData, onClick }: {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  status?: string;
  sparklineData?: Array<Record<string, number>>;
  onClick?: () => void;
}) {
  const TrendIcon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : ArrowRight;
  return (
    <button type="button" onClick={onClick} className="admin-card admin-metric-card text-left" disabled={!onClick}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-[var(--admin-text-secondary)]">{title}</span>
        <Activity size={16} className={status === 'critical' ? 'text-[var(--accent-critical)]' : 'text-[var(--accent-primary)]'} />
      </div>
      <div className="mt-3 flex items-end gap-2">
        <strong className="font-mono text-3xl leading-none text-[var(--admin-text-primary)]">{value}</strong>
        {unit ? <span className="pb-1 text-xs text-[var(--admin-text-secondary)]">{unit}</span> : null}
      </div>
      <div className="mt-3 flex h-10 items-center gap-3">
        <span className="inline-flex items-center gap-1 font-mono text-xs text-[var(--admin-text-secondary)]"><TrendIcon size={13} /> {trendValue || 'stable'}</span>
        <div className="min-w-0 flex-1">
          {sparklineData?.length ? (
            <ResponsiveContainer width="100%" height={36}>
              <AreaChart data={sparklineData}>
                <Area dataKey="value" type="monotone" stroke="var(--accent-primary)" fill="rgba(0,212,255,0.16)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </div>
    </button>
  );
}
