import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { friendlyError } from '../lib/errors.js';

interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void | Promise<void>;
}

export function ErrorState({ error, title, onRetry }: ErrorStateProps) {
  const value = friendlyError(error);
  const Icon = value.kind === 'offline' ? WifiOff : AlertTriangle;

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 text-center shadow-panel" aria-live="polite">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--danger-light)] text-[var(--danger)]">
        <Icon size={20} />
      </span>
      <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">{title || value.message}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        {title ? <><span className="font-semibold text-[var(--text-primary)]">{value.message}</span> </> : null}
        {value.action}
      </p>
      {onRetry ? (
        <button className="mobile-tap mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" type="button" onClick={onRetry}>
          <RefreshCw size={16} />
          Retry
        </button>
      ) : null}
    </section>
  );
}
