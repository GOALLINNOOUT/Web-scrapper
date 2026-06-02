import { LoaderCircle } from 'lucide-react';

interface LoadingStateProps {
  title?: string;
  rows?: number;
}

export function LoadingState({ title = 'Loading data', rows = 4 }: LoadingStateProps) {
  return (
    <section className="desktop-card grid min-h-56 content-center gap-5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-6 shadow-panel" aria-live="polite">
      <div className="flex items-center justify-center gap-3 text-[#111110]">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600"><LoaderCircle className="animate-spin" size={17} /></span>
        <div>
          <strong className="text-sm">{title}</strong>
          <small className="block text-[13px] text-muted">Syncing the latest crawl intelligence</small>
        </div>
      </div>
      <div className="grid gap-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <div className="grid grid-cols-[1.4fr_0.8fr_0.5fr] gap-3 max-[900px]:grid-cols-1" key={index}>
            <span className="h-[18px] animate-[shimmer_1.25s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,#eef1f5_0%,#f8fafc_48%,#eef1f5_100%)] bg-[length:220%_100%]" />
            <span className="h-[18px] animate-[shimmer_1.25s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,#eef1f5_0%,#f8fafc_48%,#eef1f5_100%)] bg-[length:220%_100%]" />
            <span className="h-[18px] animate-[shimmer_1.25s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,#eef1f5_0%,#f8fafc_48%,#eef1f5_100%)] bg-[length:220%_100%]" />
          </div>
        ))}
      </div>
    </section>
  );
}
