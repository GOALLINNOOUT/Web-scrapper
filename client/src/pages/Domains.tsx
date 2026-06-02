import { CheckCircle2, ChevronDown, Globe2, LoaderCircle, Mail, Network, Play, RefreshCw, Search, Share2, Sparkles } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { LoadingState } from '../components/LoadingState.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { normalizeSeedUrl } from '../lib/seedUrl.js';
import { showToast } from '../toast.js';
import type { CrawlConfig, DomainProfile } from '../types.js';
import { MobileDomains } from './MobileDomains.jsx';

const DOMAIN_CRAWL_CONFIG: Omit<CrawlConfig, 'seedUrl'> = {
  maxPages: 100,
  maxDepth: 2,
  concurrency: 5,
  sameDomainOnly: true,
  respectRobots: false,
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
};

export function Domains() {
  const isMobile = useMediaQuery('(max-width: 899px)');
  if (isMobile) return <MobileDomains />;
  return <DesktopDomains />;
}

function DesktopDomains() {
  const navigate = useNavigate();
  const [domains, setDomains] = useState<DomainProfile[]>([]);
  const [activeDomain, setActiveDomain] = useState<DomainProfile | null>(null);
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isStartingCrawl, setIsStartingCrawl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getDomains()
      .then((response) => {
        if (!cancelled) {
          setDomains(response.items);
          setActiveDomain(response.items[0] || null);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enrich(domain: string) {
    setIsEnriching(true);
    try {
      const profile = await api.enrichDomain(domain);
      setActiveDomain(profile);
      setDomains((current) => current.map((item) => item.domain === profile.domain ? profile : item));
      showToast({ title: 'Domain intelligence refreshed', description: profile.domain, tone: 'success' });
    } finally {
      setIsEnriching(false);
    }
  }

  async function lookupDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeDomainLookup(query);
    if (!value.ok) {
      setQueryError(value.message);
      showToast({ title: 'Invalid domain', description: value.message, tone: 'error' });
      return;
    }

    setQueryError('');
    setIsLookingUp(true);
    try {
      const profile = await api.lookupDomain(value.domain);
      setActiveDomain(profile);
      setDomains((current) => {
        const withoutExisting = current.filter((item) => item.domain !== profile.domain);
        return [profile, ...withoutExisting];
      });
      showToast({ title: 'Domain profile ready', description: profile.domain, tone: 'success' });
    } finally {
      setIsLookingUp(false);
    }
  }

  async function startDomainCrawl(domain: string) {
    const seedUrl = normalizeSeedUrl(domain);
    if (!seedUrl) {
      showToast({ title: 'Invalid crawl target', description: domain, tone: 'error' });
      return;
    }

    setIsStartingCrawl(true);
    try {
      const settings = await api.getSettings().catch(() => null);
      const config = settings ? {
        ...DOMAIN_CRAWL_CONFIG,
        maxPages: settings.crawling.maxPages,
        maxDepth: settings.crawling.defaultDepth,
        respectRobots: settings.crawling.respectRobots
      } : DOMAIN_CRAWL_CONFIG;
      const job = await api.createCrawl({ ...config, seedUrl });
      showToast({ title: 'Crawl started', description: domain, tone: 'success' });
      navigate(`/crawls/${job._id}`);
    } finally {
      setIsStartingCrawl(false);
    }
  }

  const hasCrawlEvidence = activeDomain ? hasDomainCrawlEvidence(activeDomain) : false;

  return (
    <div className="grid gap-6">
      <header>
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Domain profiles</span>
        <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Domain intelligence dossiers</h1>
        <p className="mt-2 text-[16px] text-[#636360]">Summaries, evidence, infrastructure, and signals for every crawled website.</p>
      </header>

      <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-[#eaeae6] bg-white p-3 shadow-panel max-[640px]:grid-cols-1" onSubmit={lookupDomain}>
        <label className="flex min-h-12 min-w-0 items-center gap-3 rounded-lg bg-[#f5f5f2] px-4">
          <Search className="shrink-0 text-brand-700" size={19} />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold outline-none placeholder:text-[#9b9b97]"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (queryError) setQueryError('');
            }}
            placeholder="Search or create a domain profile, e.g. example.com"
            inputMode="url"
          />
        </label>
        <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70" type="submit" disabled={isLookingUp || !query.trim()}>
          {isLookingUp ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}
          {isLookingUp ? 'Looking up' : 'Lookup domain'}
        </button>
        {queryError ? <p className="col-span-2 px-2 text-sm font-bold text-red-700 max-[640px]:col-span-1">{queryError}</p> : null}
      </form>

      {isLoading ? <LoadingState title="Loading domain profiles" rows={6} /> : (
        <div className="grid grid-cols-[360px_minmax(0,1fr)] gap-5 max-[1100px]:grid-cols-1">
          <section className="rounded-lg border border-[#eaeae6] bg-white p-4 shadow-panel">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-extrabold">Domains</h2>
              <span className="rounded-full bg-[#efefeb] px-3 py-1 text-sm font-extrabold text-[#636360]">{domains.length}</span>
            </div>
            <div className="grid max-h-[68vh] gap-2 overflow-y-auto pr-1">
              {domains.length === 0 ? (
                <p className="rounded-lg bg-[#f5f5f2] p-4 text-sm font-semibold text-[#636360]">No domain profiles yet. Start a crawl to generate one.</p>
              ) : null}
              {domains.map((domain) => (
                <button
                  className={`grid gap-2 rounded-lg p-4 text-left transition hover:bg-[#f5f5f2] ${activeDomain?.domain === domain.domain ? 'bg-[#ebf2ff]' : 'bg-white'}`}
                  key={domain.domain}
                  type="button"
                  onClick={() => setActiveDomain(domain)}
                >
                  <strong className="truncate text-lg">{domain.domain}</strong>
                  <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#636360]">
                    {hasDomainCrawlEvidence(domain) ? (
                      <>
                        <span>{domain.totalPages} pages</span>
                        <span>{domain.emails.length} emails</span>
                        <span>{countSocials(domain)} socials</span>
                      </>
                    ) : (
                      <span className="text-brand-700">Lookup only</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
            {!activeDomain ? (
              <div className="grid min-h-[420px] place-items-center text-center">
                <div>
                  <Globe2 className="mx-auto mb-3 text-brand-600" size={34} />
                  <h2 className="text-2xl font-extrabold">No domain selected</h2>
                  <p className="mt-2 text-sm font-semibold text-[#636360]">Crawl a website, then open its domain report here.</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Intelligence dossier</span>
                    <h2 className="mt-2 truncate text-4xl font-extrabold">{activeDomain.domain}</h2>
                    <p className="mt-2 text-sm font-semibold text-[#636360]">
                      {hasCrawlEvidence ? `Average page intelligence score: ${activeDomain.avgScore || 0}/100` : 'Infrastructure lookup ready. Crawl this domain to collect page evidence.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!hasCrawlEvidence ? (
                      <button
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
                        type="button"
                        onClick={() => startDomainCrawl(activeDomain.domain)}
                        disabled={isStartingCrawl}
                      >
                        {isStartingCrawl ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}
                        {isStartingCrawl ? 'Starting' : 'Start crawl'}
                      </button>
                    ) : null}
                    <button
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#c8c8c2] bg-white px-5 text-sm font-extrabold text-[#636360] transition hover:bg-[#f5f5f2] disabled:cursor-wait disabled:opacity-70"
                      type="button"
                      onClick={() => enrich(activeDomain.domain)}
                      disabled={isEnriching}
                    >
                      {isEnriching ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                      Refresh infrastructure
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
                  <Metric icon={Globe2} label="Pages" value={hasCrawlEvidence ? activeDomain.totalPages : 'Not crawled'} muted={!hasCrawlEvidence} />
                  <Metric icon={Mail} label="Emails" value={hasCrawlEvidence ? activeDomain.emails.length : 'Not crawled'} muted={!hasCrawlEvidence} />
                  <Metric icon={Share2} label="Socials" value={hasCrawlEvidence ? countSocials(activeDomain) : 'Not crawled'} muted={!hasCrawlEvidence} />
                  <Metric icon={Network} label="DNS provider" value={activeDomain.dns?.mailProviderGuess || 'Unknown'} />
                </div>

                {!hasCrawlEvidence ? (
                  <section className="rounded-lg border border-[#bfdbfe] bg-[#f0f5ff] p-5">
                    <h3 className="text-lg font-extrabold text-[#111110]">No crawl evidence yet</h3>
                    <p className="mt-2 text-sm leading-6 text-[#636360]">Lookup can enrich WHOIS and DNS, but page counts, emails, socials, technology stack, and scores come from crawling the website.</p>
                  </section>
                ) : null}

                <section className="rounded-lg border border-[#eaeae6] bg-[#f5f5f2] p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-xl font-extrabold">Key findings</h3>
                    <Sparkles className="text-brand-600" size={20} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
                    {buildKeyFindings(activeDomain).map((finding) => (
                      <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-lg bg-white p-4" key={finding}>
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><CheckCircle2 size={15} /></span>
                        <p className="text-sm font-semibold leading-6 text-[#636360]">{finding}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-lg border border-[#eaeae6] bg-[#f5f5f2] p-5">
                  <h3 className="text-xl font-extrabold">Technology stack</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(activeDomain.techStack || []).length === 0 ? <span className="rounded-full bg-white px-3 py-2 text-sm font-bold text-[#636360]">No technology signatures yet</span> : null}
                    {(activeDomain.techStack || []).map((tech) => (
                      <span className="rounded-full border border-[#eaeae6] bg-white px-3 py-2 text-sm font-extrabold text-brand-800" key={tech}>{tech}</span>
                    ))}
                  </div>
                </section>

                <details className="group rounded-lg border border-[#eaeae6] bg-[#f5f5f2] p-5" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xl font-extrabold">
                    Infrastructure intelligence
                    <ChevronDown className="transition group-open:rotate-180" size={20} />
                  </summary>
                  <div className="mt-5 grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
                    <InfoCard title="WHOIS" rows={[
                      ['Registrar', activeDomain.whois?.registrar || 'Unknown'],
                      ['Created', formatDate(activeDomain.whois?.creationDate)],
                      ['Expires', formatDate(activeDomain.whois?.expiryDate)],
                      ['Country', activeDomain.whois?.registrantCountry || 'Unknown'],
                      ['Status', activeDomain.whois?.error || 'Cached']
                    ]} />
                    <InfoCard title="DNS" rows={[
                      ['Mail provider', activeDomain.dns?.mailProviderGuess || 'Unknown'],
                      ['A records', (activeDomain.dns?.aRecords || []).join(', ') || 'None cached'],
                      ['MX records', (activeDomain.dns?.mxRecords || []).map((record) => record.exchange).filter(Boolean).join(', ') || 'None cached'],
                      ['Status', activeDomain.dns?.error || 'Cached']
                    ]} />
                  </div>
                </details>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, muted = false }: { icon: typeof Globe2; label: string; value: string | number; muted?: boolean }) {
  return (
    <div className="rounded-[26px] bg-[#f5f5f2] p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-extrabold text-[#636360]"><Icon size={18} /> {label}</div>
      <strong className={`block truncate ${muted ? 'text-base font-extrabold text-[#636360]' : 'text-3xl font-extrabold'}`}>{value}</strong>
    </div>
  );
}

function InfoCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-extrabold">{title}</h3>
      <div className="grid gap-3">
        {rows.map(([label, value]) => (
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-sm" key={label}>
            <span className="font-bold text-[#636360]">{label}</span>
            <strong className="min-w-0 break-words font-semibold text-[#111110]">{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildKeyFindings(domain: DomainProfile) {
  const findings: string[] = [];
  if (!hasDomainCrawlEvidence(domain)) {
    if (hasKnownMailProvider(domain)) findings.push(`${domain.dns?.mailProviderGuess} appears to handle mail infrastructure.`);
    if (domain.whois?.creationDate) findings.push(`Domain has been registered since ${formatDate(domain.whois.creationDate)}.`);
    if (domain.whois?.registrar) findings.push(`Registrar is listed as ${domain.whois.registrar}.`);
    if (findings.length === 0) findings.push('Refresh infrastructure or start a crawl to build evidence for this domain.');
    return findings.slice(0, 4);
  }

  if (domain.emails.length > 0) findings.push(`${domain.emails.length} contact signal${domain.emails.length === 1 ? '' : 's'} discovered and tied to crawl evidence.`);
  if (countSocials(domain) > 0) findings.push(`Social footprint is visible across ${countSocials(domain)} profile${countSocials(domain) === 1 ? '' : 's'}.`);
  if ((domain.techStack || []).length > 0) findings.push(`${domain.techStack?.slice(0, 3).join(', ')} detected in the public website stack.`);
  if (hasKnownMailProvider(domain)) findings.push(`${domain.dns?.mailProviderGuess} appears to handle mail infrastructure.`);
  if (domain.whois?.creationDate) findings.push(`Domain has been registered since ${formatDate(domain.whois.creationDate)}.`);
  if (domain.avgScore >= 70) findings.push('High average intelligence score indicates dense, actionable page metadata.');
  if (findings.length === 0) findings.push('Run or enrich a crawl to turn this dossier into contacts, infrastructure evidence, and page-level signals.');
  return findings.slice(0, 4);
}

function hasDomainCrawlEvidence(domain: DomainProfile) {
  return Boolean(domain.lastCrawledAt && domain.totalPages > 0);
}

function countSocials(domain: DomainProfile) {
  return Object.values(domain.socials || {}).reduce((total, values) => total + new Set(values || []).size, 0);
}

function hasKnownMailProvider(domain: DomainProfile) {
  const provider = domain.dns?.mailProviderGuess?.trim().toLowerCase();
  return Boolean(provider && provider !== 'unknown');
}

function formatDate(value?: string) {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

function normalizeDomainLookup(value: string): { ok: true; domain: string } | { ok: false; message: string } {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  if (!trimmed) return { ok: false, message: 'Enter a domain, for example example.com.' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, message: 'Enter a valid domain, for example example.com.' };
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  if (parsed.search || parsed.hash || (path && path !== '/')) {
    return { ok: false, message: 'Enter only the domain, not a page path.' };
  }

  const domain = parsed.hostname.replace(/^www\./, '');
  if (!isValidDomain(domain)) return { ok: false, message: 'Enter a valid domain, for example example.com.' };
  return { ok: true, domain };
}

function isValidDomain(domain: string) {
  if (domain.length < 4 || domain.length > 253 || !domain.includes('.') || domain.includes('..')) return false;
  const labels = domain.split('.');
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && /^[a-z]{2,63}$/.test(labels[labels.length - 1] || '');
}
