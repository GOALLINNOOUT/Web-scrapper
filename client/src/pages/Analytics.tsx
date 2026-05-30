import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Globe2, Mail, Share2 } from 'lucide-react';
import { api } from '../api.js';
import { LoadingState } from '../components/LoadingState.jsx';
import type { CrawlJob, CrawlPage } from '../types.js';

export function Analytics() {
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [pages, setPages] = useState<CrawlPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.listCrawls(), api.getData({ limit: 100 })])
      .then(([crawlJobs, data]) => {
        setJobs(crawlJobs);
        setPages(data.items);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const analytics = useMemo(() => analyze(jobs, pages), [jobs, pages]);

  return (
    <div className="grid gap-6">
      <header>
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Analytics</span>
        <h1 className="mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Crawl intelligence analysis</h1>
        <p className="mt-2 text-[16px] text-[#636360]">Understand coverage, contact yield, social discovery, and crawl health across recent data.</p>
      </header>

      {isLoading ? <LoadingState title="Analyzing crawl data" rows={5} /> : (
        <>
          <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
            <InsightCard icon={Globe2} label="Analyzed pages" value={analytics.totalPages} detail="Recent archive sample" />
            <InsightCard icon={Mail} label="Email yield" value={`${analytics.emailYield}%`} detail={`${analytics.emailPages} pages with emails`} />
            <InsightCard icon={Share2} label="Social yield" value={`${analytics.socialYield}%`} detail={`${analytics.socialPages} pages with socials`} />
            <InsightCard icon={CheckCircle2} label="Completion rate" value={`${analytics.completionRate}%`} detail={`${analytics.completedJobs} completed jobs`} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)] gap-5 max-[1100px]:grid-cols-1">
            <Panel title="Top domains" subtitle="Where discoveries are concentrated">
              <BarList rows={analytics.topDomains} />
            </Panel>

            <Panel title="Job health" subtitle="Status distribution across recent crawls">
              <BarList rows={analytics.statusRows} />
            </Panel>

            <Panel title="Social platforms" subtitle="Unique social profiles by platform">
              <BarList rows={analytics.socialRows} />
            </Panel>

            <Panel title="Recommendations" subtitle="What to optimize next">
              <div className="grid gap-3">
                {analytics.recommendations.map((item) => (
                  <div className="rounded-lg bg-[#f5f5f2] p-4" key={item}>
                    <p className="text-sm font-semibold text-[#636360]">{item}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function analyze(jobs: CrawlJob[], pages: CrawlPage[]) {
  const totalPages = pages.length;
  const emailPages = pages.filter((page) => page.emails.length > 0).length;
  const socialPages = pages.filter((page) => Object.values(page.social || {}).some((values) => values.length > 0)).length;
  const completedJobs = jobs.filter((job) => job.status === 'completed').length;
  const completionRate = percent(completedJobs, jobs.length);

  const domainCounts = countBy(pages.map((page) => page.domain || 'unknown'));
  const statusCounts = countBy(jobs.map((job) => job.status));
  const socialCounts = new Map<string, number>();

  for (const page of pages) {
    for (const [platform, values] of Object.entries(page.social || {})) {
      const count = new Set(values).size;
      if (count > 0) socialCounts.set(platform, (socialCounts.get(platform) || 0) + count);
    }
  }

  const recommendations = [
    totalPages < 25 ? 'Run a broader crawl to improve analysis confidence.' : 'Recent sample size is healthy for directional analysis.',
    emailPages === 0 ? 'No email-bearing pages found yet. Contact/about pages should be prioritized.' : 'Email discovery is active; review Data Archive for copied contacts.',
    socialPages === 0 ? 'No social profiles found yet. Enable rendered discovery for JavaScript-heavy sites.' : 'Social profiles are being grouped by platform for faster review.',
    jobs.some((job) => job.status === 'failed') ? 'Some crawls failed. Check crawl detail errors before increasing concurrency.' : 'No failed jobs in the recent job list.'
  ];

  return {
    totalPages,
    emailPages,
    socialPages,
    completedJobs,
    emailYield: percent(emailPages, totalPages),
    socialYield: percent(socialPages, totalPages),
    completionRate,
    topDomains: toRows(domainCounts).slice(0, 8),
    statusRows: toRows(statusCounts),
    socialRows: toRows(socialCounts).slice(0, 10),
    recommendations
  };
}

function InsightCard({ icon: Icon, label, value, detail }: { icon: typeof Globe2; label: string; value: string | number; detail: string }) {
  return (
    <section className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-[#636360]">{label}</span>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Icon size={18} /></span>
      </div>
      <strong className="text-4xl font-extrabold">{value}</strong>
      <p className="mt-2 text-sm font-semibold text-[#636360]">{detail}</p>
    </section>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold">{title}</h2>
          <p className="mt-1 text-sm font-semibold text-[#636360]">{subtitle}</p>
        </div>
        <Activity className="text-brand-600" size={22} />
      </div>
      {children}
    </section>
  );
}

function BarList({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  if (rows.length === 0) {
    return <p className="rounded-lg bg-[#f5f5f2] p-4 text-sm font-semibold text-[#636360]">No data available yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <div className="grid grid-cols-[130px_minmax(0,1fr)_36px] items-center gap-3" key={row.label}>
          <span className="truncate text-sm font-bold capitalize text-[#636360]">{row.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-[#e8e8e4]">
            <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }} />
          </div>
          <strong className="text-right text-sm">{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function toRows(counts: Map<string, number>) {
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}
