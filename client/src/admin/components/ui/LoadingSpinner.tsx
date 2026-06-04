export function LoadingSpinner({ label = 'Loading telemetry' }: { label?: string }) {
  return <div className="admin-card grid min-h-40 place-items-center"><span className="admin-loader" /> <span className="text-sm text-[var(--admin-text-secondary)]">{label}</span></div>;
}
