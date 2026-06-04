export function StatusBadge({ status, pulse = false, size = 'md' }: { status: string; pulse?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes('critical') || normalized.includes('crashed') || normalized.includes('failed')
    ? 'critical'
    : normalized.includes('warning') || normalized.includes('restarting')
      ? 'warning'
      : normalized.includes('offline') || normalized.includes('no data') || normalized.includes('unknown')
        ? 'offline'
        : 'healthy';
  const dotSize = size === 'sm' ? 'h-2 w-2' : size === 'lg' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';
  return (
    <span className={`admin-status admin-status-${tone} ${size === 'sm' ? 'text-[11px]' : 'text-xs'}`}>
      <span className={`${dotSize} rounded-full ${pulse || tone === 'warning' || tone === 'critical' ? 'admin-pulse-dot' : ''}`} />
      {status}
    </span>
  );
}
