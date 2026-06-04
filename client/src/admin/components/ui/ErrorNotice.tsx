import { RotateCw, TriangleAlert } from 'lucide-react';

export function ErrorNotice({ error, stale, onRetry }: {
  error: { message: string; cause: string; fix: string } | null;
  stale?: boolean;
  onRetry: () => void;
}) {
  if (!error) return stale ? <span className="admin-stale-badge">showing older data</span> : null;
  return (
    <div className="admin-error-notice">
      <TriangleAlert size={18} />
      <div className="min-w-0">
        <strong>Dashboard data is unavailable</strong>
        <p>{error.message}</p>
        <dl>
          <div><dt>What happened</dt><dd>{error.cause}</dd></div>
          <div><dt>What you can do</dt><dd>{error.fix}</dd></div>
        </dl>
      </div>
      <button className="admin-btn shrink-0" type="button" onClick={onRetry}><RotateCw size={14} /> Retry</button>
    </div>
  );
}
