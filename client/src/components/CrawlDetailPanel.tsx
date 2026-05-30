import { CrawlStatusBadge } from './CrawlStatusBadge.jsx';
import type { CrawlJob } from '../types.js';

interface CrawlDetailPanelProps {
  job: CrawlJob | null;
}

export function CrawlDetailPanel({ job }: CrawlDetailPanelProps) {
  if (!job) return null;

  return (
    <section className="grid gap-5 rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
      <div>
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Seed</span>
        <h2 className="mt-2 text-2xl font-extrabold [overflow-wrap:anywhere]">{job.seedUrl}</h2>
      </div>
      <CrawlStatusBadge status={job.status} />
      <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        <span className="rounded-lg bg-[#f5f5f2] px-4 py-3 text-sm font-semibold text-[#636360]">Pages <strong className="block text-xl text-[#111110]">{job.pagesCrawled}</strong></span>
        <span className="rounded-lg bg-[#f5f5f2] px-4 py-3 text-sm font-semibold text-[#636360]">Depth <strong className="block text-xl text-[#111110]">{job.config?.maxDepth}</strong></span>
        <span className="rounded-lg bg-[#f5f5f2] px-4 py-3 text-sm font-semibold text-[#636360]">Concurrency <strong className="block text-xl text-[#111110]">{job.config?.concurrency}</strong></span>
        <span className="rounded-lg bg-[#f5f5f2] px-4 py-3 text-sm font-semibold text-[#636360]">Same domain <strong className="block text-xl text-[#111110]">{job.config?.sameDomainOnly ? 'On' : 'Off'}</strong></span>
      </div>
    </section>
  );
}
