import { ChevronRight, Globe2, LoaderCircle, Mail, Network, Play, RefreshCw, Search, Share2, ShieldCheck, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorState } from '../components/ErrorState.jsx';
import { normalizeSeedUrl } from '../lib/seedUrl.js';
import { showToast } from '../toast.js';
import type { CrawlConfig, DomainProfile } from '../types.js';

const DOMAIN_CRAWL_CONFIG: Omit<CrawlConfig, 'seedUrl'> = {
  maxPages: 100,
  maxDepth: 2,
  concurrency: 5,
  sameDomainOnly: true,
  respectRobots: false,
  discovery: { sitemap: true, renderJavaScript: true, renderWhenStaticLinksBelow: 20, includeMetaLinks: true },
  extract: { links: true, emails: true, metadata: true, social: true }
};

export function MobileDomains() {
  const navigate = useNavigate();
  const [domains, setDomains] = useState<DomainProfile[]>([]);
  const [activeDomain, setActiveDomain] = useState<DomainProfile | null>(null);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [startingDomain, setStartingDomain] = useState('');

  useEffect(() => {
    api.getDomains()
      .then((response) => {
        setDomains(response.items);
        setLoadError(null);
      })
      .catch(setLoadError)
      .finally(() => setIsLoading(false));
  }, []);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = query.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!domain.includes('.')) {
      showToast({ title: 'Invalid domain', description: 'Enter a domain like example.com', tone: 'error' });
      return;
    }

    setIsLookingUp(true);
    try {
      const profile = await api.lookupDomain(domain);
      setDomains((current) => [profile, ...current.filter((item) => item.domain !== profile.domain)]);
      setActiveDomain(profile);
      setQuery('');
    } finally {
      setIsLookingUp(false);
    }
  }

  async function enrich(domain: DomainProfile) {
    setIsEnriching(true);
    try {
      const profile = await api.enrichDomain(domain.domain);
      setActiveDomain(profile);
      setDomains((current) => current.map((item) => item.domain === profile.domain ? profile : item));
      showToast({ title: 'Domain intelligence refreshed', description: profile.domain, tone: 'success' });
    } finally {
      setIsEnriching(false);
    }
  }

  async function startCrawl(domain: string) {
    const seedUrl = normalizeSeedUrl(domain);
    if (!seedUrl) return;
    setStartingDomain(domain);
    try {
      const settings = await api.getSettings().catch(() => null);
      const config = settings ? { ...DOMAIN_CRAWL_CONFIG, maxPages: settings.crawling.maxPages, maxDepth: settings.crawling.defaultDepth, respectRobots: settings.crawling.respectRobots } : DOMAIN_CRAWL_CONFIG;
      const job = await api.createCrawl({ ...config, seedUrl });
      navigate(`/crawls/${job._id}`);
    } finally {
      setStartingDomain('');
    }
  }

  return (
    <div className="mobile-page-enter px-4 pb-[112px] pt-2">
      <form className="grid grid-cols-[minmax(0,1fr)_44px] gap-2" onSubmit={lookup}>
        <label className="grid h-11 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] px-3">
          <Search size={17} className="text-[var(--text-secondary)]" />
          <input className="min-w-0 border-0 bg-transparent text-sm outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Lookup domain" />
        </label>
        <button className="mobile-icon-btn h-11 w-11" type="submit" aria-label="Lookup domain" disabled={isLookingUp}>{isLookingUp ? <LoaderCircle className="animate-spin" size={17} /> : <Search size={17} />}</button>
      </form>

      <h2 className="mobile-section-label !px-0">Profiles</h2>
      {isLoading ? <div className="grid gap-2">{[0, 1, 2].map((item) => <span className="mobile-skeleton h-28 rounded-xl" key={item} />)}</div> : null}
      {!isLoading && loadError ? <ErrorState error={loadError} title="Could not load domains" onRetry={() => {
        setIsLoading(true);
        setLoadError(null);
        return api.getDomains().then((response) => setDomains(response.items)).catch(setLoadError).finally(() => setIsLoading(false));
      }} /> : null}
      {!isLoading && !loadError && domains.length === 0 ? <div className="rounded-xl bg-[var(--bg-base)] p-8 text-center"><Globe2 className="mx-auto text-[var(--accent)]" size={34} /><p className="mt-3 text-sm font-semibold">No domains yet</p></div> : null}
      <div className="grid gap-2">
        {!loadError && domains.map((domain) => (
          <button className="mobile-crawl-card mobile-tap w-full text-left" key={domain.domain} type="button" onClick={() => setActiveDomain(domain)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block truncate text-base">{domain.domain}</strong>
                <span className="mt-1 block text-[11px] font-semibold text-[var(--text-secondary)]">{domainSummary(domain)}</span>
              </div>
              {(domain.avgScore || 0) > 0 ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-light)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--accent)]">{domain.avgScore}<ChevronRight size={12} /></span> : <ChevronRight className="shrink-0 text-[var(--text-tertiary)]" size={17} />}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
              <Mail size={13} /> {domain.emails.length}
              <Share2 size={13} /> {countSocials(domain)}
              <Network size={13} /> {domain.dns?.mailProviderGuess || 'DNS'}
              <ShieldCheck size={13} /> {domain.whois?.registrar || 'WHOIS'}
            </div>
            <span className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--bg-raised)] text-sm font-semibold text-[var(--accent)]">Open dossier <ChevronRight size={16} /></span>
          </button>
        ))}
      </div>

      <DomainDetailSheet
        domain={activeDomain}
        isEnriching={isEnriching}
        isStarting={Boolean(activeDomain && startingDomain === activeDomain.domain)}
        onClose={() => setActiveDomain(null)}
        onEnrich={enrich}
        onStartCrawl={(domain) => startCrawl(domain.domain)}
      />
    </div>
  );
}

function DomainDetailSheet({ domain, isEnriching, isStarting, onClose, onEnrich, onStartCrawl }: { domain: DomainProfile | null; isEnriching: boolean; isStarting: boolean; onClose: () => void; onEnrich: (domain: DomainProfile) => void; onStartCrawl: (domain: DomainProfile) => void }) {
  if (!domain) return null;
  const hasCrawl = Boolean(domain.lastCrawledAt && domain.totalPages > 0);

  return createPortal(
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-labelledby="domain-detail-title">
      <button className="mobile-sheet-overlay absolute inset-0 w-full" type="button" aria-label="Close domain detail" onClick={onClose} />
      <section className="mobile-sheet-panel absolute bottom-0 left-0 right-0 h-[86vh]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
          <span className="mx-auto block h-1 w-9 rounded-full bg-[var(--border-default)]" />
          <button className="mobile-icon-btn absolute right-4 top-3" type="button" aria-label="Close domain detail" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="no-scrollbar h-[calc(86vh-53px)] overflow-y-auto px-5 pb-8 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{hasCrawl ? 'Crawled domain' : 'Lookup dossier'}</span>
              <h2 id="domain-detail-title" className="mt-2 truncate text-2xl font-semibold">{domain.domain}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{hasCrawl ? `${domain.totalPages} pages - score ${domain.avgScore || 0}` : 'Infrastructure intelligence available before crawl evidence.'}</p>
            </div>
            <span className="rounded-full bg-[var(--accent-light)] px-3 py-2 font-mono text-xs font-semibold text-[var(--accent)]">{domain.avgScore || 0}</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <DetailMetric icon={Globe2} label="Pages" value={hasCrawl ? domain.totalPages : 'Not crawled'} />
            <DetailMetric icon={Mail} label="Emails" value={hasCrawl ? domain.emails.length : 'Not crawled'} />
            <DetailMetric icon={Share2} label="Socials" value={hasCrawl ? countSocials(domain) : 'Not crawled'} />
            <DetailMetric icon={Network} label="Mail" value={domain.dns?.mailProviderGuess || 'Unknown'} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="mobile-tap inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-white" type="button" onClick={() => onStartCrawl(domain)} disabled={isStarting}>
              {isStarting ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}
              Crawl
            </button>
            <button className="mobile-tap inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--bg-raised)] px-3 text-sm font-semibold text-[var(--accent)]" type="button" onClick={() => onEnrich(domain)} disabled={isEnriching}>
              {isEnriching ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>

          <InfoSection title="WHOIS" rows={[
            ['Registrar', domain.whois?.registrar || 'Unknown'],
            ['Created', formatDate(domain.whois?.creationDate)],
            ['Updated', formatDate(domain.whois?.updatedDate)],
            ['Expires', formatDate(domain.whois?.expiryDate)],
            ['Country', domain.whois?.registrantCountry || 'Unknown'],
            ['Nameservers', (domain.whois?.nameServers || []).join(', ') || 'Unknown'],
            ['Status', domain.whois?.error || 'Cached']
          ]} />

          <InfoSection title="DNS" rows={[
            ['Mail provider', domain.dns?.mailProviderGuess || 'Unknown'],
            ['A records', (domain.dns?.aRecords || []).join(', ') || 'None cached'],
            ['MX records', (domain.dns?.mxRecords || []).map((record) => record.exchange).filter(Boolean).join(', ') || 'None cached'],
            ['TXT records', (domain.dns?.txtRecords || []).flat().slice(0, 3).join(', ') || 'None cached'],
            ['Status', domain.dns?.error || 'Cached']
          ]} />

          <section className="mt-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">Technology</h3>
            <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
              {(domain.techStack || []).length ? domain.techStack?.map((tech) => <span className="rounded-full bg-[var(--accent-light)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]" key={tech}>{tech}</span>) : <span className="text-sm text-[var(--text-secondary)]">No technology signatures yet. Start a crawl to collect page evidence.</span>}
            </div>
          </section>
        </div>
      </section>
    </div>,
    document.body
  );
}

function DetailMetric({ icon: Icon, label, value }: { icon: typeof Globe2; label: string; value: string | number }) {
  return <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"><div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]"><span>{label}</span><Icon size={15} /></div><strong className="mt-3 block truncate font-mono text-lg">{value}</strong></div>;
}

function InfoSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{title}</h3>
      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)]">
        {rows.map(([label, value]) => (
          <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0" key={label}>
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
            <strong className="min-w-0 break-words text-xs font-semibold text-[var(--text-primary)]">{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function countSocials(domain: DomainProfile) {
  return Object.values(domain.socials || {}).reduce((total, values) => total + new Set(values || []).size, 0);
}

function domainSummary(domain: DomainProfile) {
  if (domain.lastCrawledAt && domain.totalPages > 0) return `${domain.totalPages} pages - score ${domain.avgScore || 0}`;
  if (domain.dns?.mailProviderGuess || domain.whois?.registrar) return `${domain.dns?.mailProviderGuess || 'DNS ready'} - ${domain.whois?.registrar || 'WHOIS ready'}`;
  return 'Lookup profile - crawl for page evidence';
}

function formatDate(value?: string) {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
