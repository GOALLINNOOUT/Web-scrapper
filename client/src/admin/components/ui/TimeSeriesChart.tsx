import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function TimeSeriesChart({ data, lines, height = 280, showGrid = true, yDomain, referenceLines = [] }: {
  data: Array<Record<string, unknown>>;
  lines: Array<{ key: string; color: string; label: string }>;
  height?: number;
  showGrid?: boolean;
  showBrush?: boolean;
  yDomain?: [number, number] | ['auto', 'auto'];
  referenceLines?: Array<{ y: number; label?: string; color?: string }>;
}) {
  const normalizedData = data.map((item) => {
    const next = { ...item };
    for (const line of lines) next[line.key] = normalizeChartValue(item[line.key]);
    return next;
  });
  const hasData = normalizedData.length > 0;
  const hasVisibleValue = normalizedData.some((item) => lines.some((line) => Number(item[line.key]) !== 0));
  const showDots = normalizedData.length < 3;

  if (!hasData) {
    return (
      <div className="admin-chart-empty" style={{ minHeight: height }}>
        <span>No samples in this time range</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={normalizedData}>
        {showGrid ? <CartesianGrid stroke="rgba(226,232,240,0.10)" vertical={false} /> : null}
        <XAxis dataKey="timestamp" tick={{ fill: 'var(--admin-text-secondary)', fontSize: 11 }} tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
        <YAxis domain={yDomain} tick={{ fill: 'var(--admin-text-secondary)', fontSize: 11 }} />
        <Tooltip contentStyle={{ background: 'var(--admin-bg-elevated)', border: '1px solid var(--admin-border)', color: 'var(--admin-text-primary)' }} labelFormatter={(value) => new Date(String(value)).toLocaleString()} formatter={(value, name) => [formatTooltipValue(Number(value), String(name)), name]} />
        <Legend />
        {!hasVisibleValue ? <ReferenceLine y={0} stroke="rgba(226,232,240,0.24)" /> : null}
        {referenceLines.map((line) => <ReferenceLine key={`${line.y}-${line.label}`} y={line.y} stroke={line.color || 'var(--accent-critical)'} label={line.label} />)}
        {lines.map((line) => <Line key={line.key} dataKey={line.key} name={line.label} stroke={line.color} dot={showDots ? { r: 3, strokeWidth: 2 } : false} activeDot={{ r: 4 }} strokeWidth={2} isAnimationActive={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

function normalizeChartValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatTooltipValue(value: number, name: string) {
  if (/memory/i.test(name) && value > 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (/memory/i.test(name)) return `${value.toFixed(1)} MB`;
  if (/latency|response/i.test(name)) return `${value.toFixed(1)} ms`;
  if (/cpu|rate|success/i.test(name)) return `${value.toFixed(1)}%`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}
