import type { FormEvent } from 'react';
import { AtSign, Bot, Database, Gauge, Globe2, KeyRound, Link2, LoaderCircle, Mail, Play, Share2, ShieldCheck, SlidersHorizontal, Tags, Webhook } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { normalizeSeedUrl } from '../lib/seedUrl.js';
import { showToast } from '../toast.js';
import type { CrawlConfig, ExtractConfig } from '../types.js';

export function Settings() {
  const navigate = useNavigate();
  const [form, setForm] = useState<CrawlConfig>({
    seedUrl: '',
    maxPages: 100,
    maxDepth: 2,
    concurrency: 5,
    sameDomainOnly: true,
    discovery: {
      sitemap: true,
      renderJavaScript: true,
      renderWhenStaticLinksBelow: 20,
      includeMetaLinks: true
    },
    extract: {
      links: true,
      emails: true,
      metadata: true,
      social: true
    }
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof CrawlConfig>(key: K, value: CrawlConfig[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateExtract(key: keyof ExtractConfig, value: boolean) {
    setForm((current) => ({
      ...current,
      extract: { ...current.extract, [key]: value }
    }));
  }

  function updateDiscovery<K extends keyof CrawlConfig['discovery']>(key: K, value: CrawlConfig['discovery'][K]) {
    setForm((current) => ({
      ...current,
      discovery: { ...current.discovery, [key]: value }
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const normalizedSeedUrl = normalizeSeedUrl(form.seedUrl);
    if (!normalizedSeedUrl) {
      const message = 'Enter a valid website, for example example.com or https://example.com';
      setError(message);
      showToast({ title: 'Invalid crawl target', description: message, tone: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = { ...form, seedUrl: normalizedSeedUrl };
      const job = await api.createCrawl(payload);
      showToast({ title: 'Crawl started', description: normalizedSeedUrl, tone: 'success' });
      navigate(`/crawls/${job._id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to start crawl');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <header className="flex items-end justify-between gap-4 max-[720px]:grid">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Settings</span>
          <h1 className="mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Start a crawl</h1>
          <p className="mt-2 text-[16px] text-[#636360]">Configure scope, speed, and extraction behavior before launching a job.</p>
        </div>
      </header>

      <form onSubmit={submit}>
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-[1100px]:grid-cols-1">
          <div className="grid gap-5">
          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Globe2 size={20} /></span>
              <div>
                <h2 className="text-xl font-extrabold">Crawl target</h2>
                <span className="text-sm font-semibold text-[#636360]">Seed URL and traversal boundaries</span>
              </div>
            </div>
            <label className="block">
              <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#636360]">Seed URL</span>
              <input
                className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-4 py-3 text-sm font-semibold text-[#111110] outline-none transition placeholder:text-[#9b9b97] focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
                value={form.seedUrl}
                onChange={(event) => update('seedUrl', event.target.value)}
                placeholder="example.com or https://example.com"
                inputMode="url"
                autoComplete="url"
              />
            </label>
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-[#f5f5f2] p-4">
              <span>
                <strong className="block text-sm">Restrict to same domain</strong>
                <small className="block text-sm text-[#636360]">Keep the crawl focused on the seed website.</small>
              </span>
              <input className="h-5 w-5 accent-brand-600" type="checkbox" checked={form.sameDomainOnly} onChange={(event) => update('sameDomainOnly', event.target.checked)} />
            </label>
          </section>

          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Link2 size={20} /></span>
              <div>
                <h2 className="text-xl font-extrabold">Link discovery</h2>
                <span className="text-sm font-semibold text-[#636360]">Find more pages from rendered DOM and sitemaps</span>
              </div>
            </div>
            <div className="grid gap-3">
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-[#f5f5f2] p-4">
                <span>
                  <strong className="block text-sm">Use sitemap discovery</strong>
                  <small className="block text-sm text-[#636360]">Pull URLs from robots.txt and sitemap.xml before crawling.</small>
                </span>
                <input className="h-5 w-5 accent-brand-600" type="checkbox" checked={form.discovery.sitemap} onChange={(event) => updateDiscovery('sitemap', event.target.checked)} />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-[#f5f5f2] p-4">
                <span>
                  <strong className="block text-sm">Render JavaScript pages</strong>
                  <small className="block text-sm text-[#636360]">Use a browser pass when static HTML has too few links.</small>
                </span>
                <input className="h-5 w-5 accent-brand-600" type="checkbox" checked={form.discovery.renderJavaScript} onChange={(event) => updateDiscovery('renderJavaScript', event.target.checked)} />
              </label>
              <label className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4">
                <span className="flex items-center justify-between text-sm font-bold text-[#636360]">Render below link count <strong className="text-[#111110]">{form.discovery.renderWhenStaticLinksBelow}</strong></span>
                <input className="accent-brand-600" type="range" min="0" max="100" value={form.discovery.renderWhenStaticLinksBelow} onChange={(event) => updateDiscovery('renderWhenStaticLinksBelow', Number(event.target.value))} />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-[#f5f5f2] p-4">
                <span>
                  <strong className="block text-sm">Include page hint links</strong>
                  <small className="block text-sm text-[#636360]">Use canonical, alternate, next, and prev link tags.</small>
                </span>
                <input className="h-5 w-5 accent-brand-600" type="checkbox" checked={form.discovery.includeMetaLinks} onChange={(event) => updateDiscovery('includeMetaLinks', event.target.checked)} />
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Gauge size={20} /></span>
              <div>
                <h2 className="text-xl font-extrabold">Limits</h2>
                <span className="text-sm font-semibold text-[#636360]">Control crawl size and speed</span>
              </div>
            </div>
            <div className="grid gap-4">
              <label className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4">
                <span className="flex items-center justify-between text-sm font-bold text-[#636360]">Max pages <strong className="text-[#111110]">{form.maxPages}</strong></span>
                <input className="accent-brand-600" type="range" min="1" max="1000" value={form.maxPages} onChange={(event) => update('maxPages', Number(event.target.value))} />
              </label>
              <label className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4">
                <span className="flex items-center justify-between text-sm font-bold text-[#636360]">Max depth <strong className="text-[#111110]">{form.maxDepth}</strong></span>
                <input className="accent-brand-600" type="range" min="0" max="10" value={form.maxDepth} onChange={(event) => update('maxDepth', Number(event.target.value))} />
              </label>
              <label className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4">
                <span className="flex items-center justify-between text-sm font-bold text-[#636360]">Concurrency <strong className="text-[#111110]">{form.concurrency}</strong></span>
                <input className="accent-brand-600" type="range" min="1" max="10" value={form.concurrency} onChange={(event) => update('concurrency', Number(event.target.value))} />
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><SlidersHorizontal size={20} /></span>
              <div>
                <h2 className="text-xl font-extrabold">Extraction</h2>
                <span className="text-sm font-semibold text-[#636360]">Choose the intelligence to collect</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
              {(Object.entries(form.extract) as [keyof ExtractConfig, boolean][]).map(([key, value]) => {
                const icons = {
                  links: Link2,
                  emails: AtSign,
                  metadata: Tags,
                  social: Share2,
                  content: Database
                } satisfies Record<keyof ExtractConfig, typeof Mail>;
                const Icon = icons[key];
                return (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-[#f5f5f2] p-4 transition hover:bg-[#efefeb]" key={key}>
                  <Icon size={18} />
                  <span>
                    <strong className="block capitalize">{key}</strong>
                    <small className="block text-sm text-[#636360]">{value ? 'Enabled' : 'Disabled'}</small>
                  </span>
                  <input className="ml-auto h-5 w-5 accent-brand-600" type="checkbox" checked={value} onChange={(event) => updateExtract(key, event.target.checked)} />
                </label>
              );})}
            </div>
          </section>
          </div>

          <aside className="sticky top-6 h-fit rounded-lg bg-gradient-to-br from-brand-800 to-brand-600 p-6 text-white shadow-[0_28px_70px_rgba(17,112,66,0.24)] max-[1100px]:static">
            <div className="mb-5 grid h-12 w-12 place-items-center rounded-full bg-white/15"><Bot size={24} /></div>
            <h2 className="text-2xl font-extrabold">Ready to crawl</h2>
            <p className="mt-2 text-sm font-semibold text-white/75">{form.maxPages} pages, depth {form.maxDepth}, {form.concurrency} workers.</p>
            <div className="mt-5 grid gap-2.5">
              <span className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-4 py-3 text-sm font-bold"><Database size={15} /> MongoDB storage</span>
              <span className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-4 py-3 text-sm font-bold"><Globe2 size={15} /> {form.sameDomainOnly ? 'Same-domain crawl' : 'Open-domain crawl'}</span>
              <span className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-4 py-3 text-sm font-bold"><Link2 size={15} /> {form.discovery.renderJavaScript ? 'Rendered discovery' : 'Static discovery'}</span>
            </div>
            {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
            <button className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 font-extrabold text-brand-800 transition hover:bg-[#efefeb] disabled:cursor-wait disabled:opacity-70" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}
              {isSubmitting ? 'Starting' : 'Start crawl'}
            </button>
          </aside>
        </div>
      </form>

      <section className="grid grid-cols-3 gap-4 max-[1000px]:grid-cols-1">
        <SettingsCard icon={ShieldCheck} title="Workspace" body="Local workspace isolation uses the device header today and is ready to map onto authenticated workspace IDs." />
        <SettingsCard icon={Webhook} title="Webhooks" body="Change events are recorded with HMAC-ready payload signatures; endpoint management is reserved for the next monetized phase." />
        <SettingsCard icon={KeyRound} title="API keys" body="Secrets stay in environment variables. Production auth can be enabled without changing crawler storage contracts." />
      </section>
    </div>
  );
}

function SettingsCard({ icon: Icon, title, body }: { icon: typeof ShieldCheck; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[#eaeae6] bg-white p-5 shadow-panel">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e8f0ff] text-[#0066ff]"><Icon size={20} /></span>
      <h2 className="mt-4 text-xl font-extrabold">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#6b6b6b]">{body}</p>
    </div>
  );
}
