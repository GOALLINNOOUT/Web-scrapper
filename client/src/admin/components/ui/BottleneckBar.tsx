export function BottleneckBar({ label, score, severity }: { label: string; score: number; severity: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm"><span>{label}</span><span className="font-mono">{score}</span></div>
      <div className="h-2 overflow-hidden rounded bg-[var(--admin-bg-base)]"><div className={`h-full ${severity === 'critical' ? 'bg-[var(--accent-critical)]' : severity === 'warning' ? 'bg-[var(--accent-warning)]' : 'bg-[var(--accent-primary)]'}`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} /></div>
    </div>
  );
}
