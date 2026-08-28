export function StatusBadge({ status, pulse = false, size = 'md' }: { status: string; pulse?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes('critical') || normalized.includes('crashed') || normalized.includes('failed')
    ? 'critical'
    : normalized.includes('warning') || normalized.includes('restarting')
      ? 'warning'
    : normalized.includes('stale')
      ? 'stale'
      : normalized.includes('offline') || normalized.includes('no data') || normalized.includes('unknown')
        ? 'offline'
        : normalized.includes('idle')
          ? 'idle'
          : normalized.includes('active') || normalized.includes('running')
            ? 'active'
            : 'healthy';
  const dotSize = size === 'sm' ? 'h-2 w-2' : size === 'lg' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';
  const shouldPulse = (pulse && tone !== 'idle' && tone !== 'offline') || tone === 'warning' || tone === 'critical' || tone === 'stale';
  return (
    <span className={`admin-status admin-status-${tone} ${size === 'sm' ? 'text-[11px]' : 'text-xs'}`}>
      <span className={`${dotSize} rounded-full ${shouldPulse ? 'admin-pulse-dot' : ''}`} />
      {status}
    </span>
  );
}
