interface ExplorerFilters {
  q: string;
  domain: string;
  hasEmails: boolean;
  hasSocial: boolean;
  classification: string;
  techStack: string;
  minScore: number;
}

interface FilterBarProps {
  filters: ExplorerFilters;
  onChange: (filters: ExplorerFilters) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="desktop-card grid grid-cols-[minmax(240px,1.2fr)_minmax(180px,0.8fr)_minmax(150px,0.6fr)_minmax(160px,0.6fr)_minmax(150px,0.5fr)_auto_auto] items-end gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 shadow-panel max-[1180px]:grid-cols-3 max-[800px]:grid-cols-2 max-[620px]:grid-cols-1">
      <label className="block min-w-0">
        <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#636360]">Search</span>
        <input
          className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-semibold text-[#111110] outline-none transition placeholder:text-[#9b9b97] focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
          placeholder="email, link, title, social profile"
        />
      </label>
      <label className="block min-w-0">
        <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#636360]">Domain</span>
        <input
          className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-semibold text-[#111110] outline-none transition placeholder:text-[#9b9b97] focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
          value={filters.domain}
          onChange={(event) => onChange({ ...filters, domain: event.target.value })}
          placeholder="example.com"
        />
      </label>
      <label className="block min-w-0">
        <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#636360]">Page type</span>
        <select
          className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-semibold text-[#111110] outline-none transition focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
          value={filters.classification}
          onChange={(event) => onChange({ ...filters, classification: event.target.value })}
        >
          <option value="">Any type</option>
          <option value="contact">Contact</option>
          <option value="pricing">Pricing</option>
          <option value="article">Article</option>
          <option value="jobs">Jobs</option>
          <option value="about">About</option>
          <option value="product">Product</option>
          <option value="general">General</option>
        </select>
      </label>
      <label className="block min-w-0">
        <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#636360]">Tech</span>
        <input
          className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-semibold text-[#111110] outline-none transition placeholder:text-[#9b9b97] focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
          value={filters.techStack}
          onChange={(event) => onChange({ ...filters, techStack: event.target.value })}
          placeholder="Next.js, Shopify"
        />
      </label>
      <label className="block min-w-0">
        <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#636360]">Min score</span>
        <input
          className="h-12 w-full rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-semibold text-[#111110] outline-none transition placeholder:text-[#9b9b97] focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
          value={filters.minScore || ''}
          onChange={(event) => onChange({ ...filters, minScore: Number(event.target.value) || 0 })}
          placeholder="70"
          inputMode="numeric"
        />
      </label>
      <label className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-extrabold text-[#636360] transition hover:bg-white">
        <input
          className="h-4 w-4 accent-brand-600"
          type="checkbox"
          checked={filters.hasEmails}
          onChange={(event) => onChange({ ...filters, hasEmails: event.target.checked })}
        />
        Has emails
      </label>
      <label className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border border-[#eaeae6] bg-[#f5f5f2] px-4 text-sm font-extrabold text-[#636360] transition hover:bg-white">
        <input
          className="h-4 w-4 accent-brand-600"
          type="checkbox"
          checked={filters.hasSocial}
          onChange={(event) => onChange({ ...filters, hasSocial: event.target.checked })}
        />
        Has socials
      </label>
    </div>
  );
}
