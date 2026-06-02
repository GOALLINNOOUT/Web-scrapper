import { Image, Info, LoaderCircle, Tags, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { useActionLock } from '../lib/actionLocks.js';
import { CopyButton } from './CopyButton.jsx';
import type { MetadataPreview } from '../types.js';

interface MetadataPreviewButtonProps {
  url: string;
}

export function MetadataPreviewButton({ url }: MetadataPreviewButtonProps) {
  const [preview, setPreview] = useState<MetadataPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { isLocked, runLocked } = useActionLock('metadata-preview');

  function closePreview() {
    setPreview(null);
    setError('');
  }

  async function openPreview() {
    await runLocked(async () => {
      setError('');
      setIsLoading(true);
      try {
        setPreview(await api.previewMetadata(url));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to fetch metadata');
      } finally {
        setIsLoading(false);
      }
    });
  }

  return (
    <>
      <button
        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#c8c8c2] bg-white px-3 text-xs font-extrabold text-[#636360] transition hover:border-brand-300 hover:text-brand-800 disabled:cursor-wait disabled:opacity-70"
        type="button"
        onClick={openPreview}
        disabled={isLoading || isLocked}
        title="View live metadata"
      >
        {isLoading ? <LoaderCircle className="animate-spin" size={13} /> : <Tags size={13} />}
        Metadata
      </button>

      {preview || error ? createPortal((
        <div className="fixed inset-0 z-[2147483000] grid place-items-center overflow-hidden bg-black/45 px-4 py-6 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-label="Live metadata preview" onMouseDown={closePreview}>
          <section className="max-h-[min(92vh,920px)] w-full max-w-5xl overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 text-[var(--text-primary)] shadow-[0_28px_90px_rgba(0,0,0,0.30)]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Live metadata</span>
                <h2 className="mt-1 truncate text-2xl font-extrabold">{preview?.metadata.title || url}</h2>
                <p className="mt-1 break-words text-sm font-semibold text-[#636360]">{preview?.url || url}</p>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-full bg-[var(--bg-raised)] text-[var(--text-secondary)]" type="button" onClick={closePreview} aria-label="Close metadata preview">
                <X size={16} />
              </button>
            </div>

            {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}

            {preview ? (
              <div className="grid gap-5">
                {(() => {
                  const snippets = buildMetadataSnippets(preview);
                  const metadataItems = [
                    metadataItem('Description', preview.metadata.description || preview.metadata.ogDescription, 'Search engines and link previews use this to explain the page.', snippets.description, 'Critical'),
                    metadataItem('Canonical', preview.metadata.canonical, 'Tells search engines the official URL for duplicate or similar pages.', snippets.canonical, 'Critical'),
                    metadataItem('Language', preview.metadata.language, 'Helps browsers, translation tools, and search engines understand the page language.', '<html lang="en">', 'Critical'),
                    metadataItem('Site name', preview.metadata.siteName, 'Improves brand display in social cards and rich previews.', snippets.siteName, 'Recommended'),
                    metadataItem('Robots', preview.metadata.robots, 'Controls whether search engines should index or follow this page.', '<meta name="robots" content="index,follow">', 'Recommended'),
                    metadataItem('Author', preview.metadata.author, 'Shows content ownership and can help article/entity interpretation.', snippets.author, 'Optional'),
                    metadataItem('Publisher', preview.metadata.publisher, 'Identifies the publishing organization behind the page.', snippets.publisher, 'Optional'),
                    metadataItem('Generator', preview.metadata.generator, 'Reveals CMS/framework hints such as WordPress, Shopify, or custom tooling.', '<meta name="generator" content="CMS or framework name">', 'Diagnostic'),
                    metadataItem('Application', preview.metadata.applicationName, 'Names the web app when saved to a device or shown in app contexts.', snippets.applicationName, 'Optional'),
                    metadataItem('Viewport', preview.metadata.viewport, 'Makes mobile rendering predictable and responsive.', '<meta name="viewport" content="width=device-width, initial-scale=1">', 'Critical'),
                    metadataItem('Theme color', preview.metadata.themeColor, 'Sets browser UI color on mobile and installed web apps.', '<meta name="theme-color" content="#0A6EFF">', 'Optional'),
                    metadataItem('Favicon', preview.metadata.favicon, 'Shows the site icon in tabs, bookmarks, and search surfaces.', snippets.favicon, 'Recommended'),
                    metadataItem('Manifest', preview.metadata.manifest, 'Enables installable PWA metadata like name, icons, and theme.', snippets.manifest, 'Optional'),
                    metadataItem('AMP URL', preview.metadata.ampUrl, 'Points to an AMP version when the site supports AMP pages.', snippets.ampUrl, 'Optional'),
                    metadataItem('OG type', preview.metadata.ogType, 'Tells social platforms whether this is a website, article, product, etc.', snippets.ogType, 'Recommended'),
                    metadataItem('OG URL', preview.metadata.ogUrl, 'Gives social platforms the canonical URL for shared previews.', snippets.ogUrl, 'Recommended'),
                    metadataItem('Twitter card', preview.metadata.twitterCard, 'Controls the Twitter/X preview format.', '<meta name="twitter:card" content="summary_large_image">', 'Recommended'),
                    metadataItem('Twitter site', preview.metadata.twitterSite, 'Associates previews with a brand Twitter/X account.', '<meta name="twitter:site" content="@brand">', 'Optional'),
                    metadataItem('Keywords', (preview.metadata.keywords || []).join(', '), 'Legacy SEO hint; less important today, but useful as quick topic evidence.', snippets.keywords, 'Optional'),
                    metadataItem('Structured data', (preview.metadata.jsonLdTypes || []).join(', '), 'Helps search engines understand entities like Article, Product, FAQ, Organization.', snippets.structuredData, 'Recommended'),
                    metadataItem('Alternate languages', (preview.metadata.alternateLanguages || []).map((item) => item.hrefLang).join(', '), 'Connects translated or regional versions of the page.', snippets.alternateLanguage, 'Optional'),
                    metadataItem('Links', String(preview.links.length), 'Links show crawl paths and page relationships.', '<a href="/important-page">Important page</a>', 'Diagnostic'),
                    metadataItem('Emails', String(preview.emails.length), 'Email signals reveal contact or lead information.', snippets.email, 'Optional'),
                    metadataItem('Social profiles', String(new Set(Object.values(preview.social || {}).flat()).size), 'Social links connect the site to public brand/community profiles.', snippets.socialProfile, 'Recommended'),
                    metadataItem('Images', String(preview.images.length), 'Images support preview quality and visual inspection.', snippets.ogImage, 'Recommended')
                  ];
                  const columns = splitMetadataColumns(metadataItems);
                  return (
                    <>
                {preview.metadata.ogImage ? (
                  <img className="max-h-72 w-full rounded-lg object-cover" src={preview.metadata.ogImage} alt="" />
                ) : null}

                <div className="grid grid-cols-2 items-start gap-3 max-[700px]:grid-cols-1">
                  {columns.map((column, index) => (
                    <div className="grid min-w-0 gap-3" key={index}>
                      {column.map((item) => <InfoBlock item={item} key={item.label} />)}
                    </div>
                  ))}
                </div>
                    </>
                  );
                })()}

                {preview.images.length > 0 ? (
                  <div>
                    <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-extrabold"><Image size={15} /> Images</h3>
                    <div className="grid grid-cols-4 gap-2 max-[700px]:grid-cols-2">
                      {preview.images.slice(0, 12).map((image) => (
                        <img className="aspect-video rounded-md object-cover" src={image} alt="" key={image} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}

interface MetadataInfoItem {
  label: string;
  value: string;
  help: string;
  fix: string;
  priority: 'Critical' | 'Recommended' | 'Optional' | 'Diagnostic';
  missing: boolean;
}

function metadataItem(label: string, value: string | undefined, help: string, fix: string, priority: MetadataInfoItem['priority']): MetadataInfoItem {
  const displayValue = value?.trim() || 'Missing';
  return {
    label,
    value: displayValue,
    help,
    fix,
    priority,
    missing: displayValue === 'Missing' || displayValue === '0'
  };
}

function splitMetadataColumns(items: MetadataInfoItem[]) {
  const left: MetadataInfoItem[] = [];
  const right: MetadataInfoItem[] = [];
  items.forEach((item, index) => {
    (index % 2 === 0 ? left : right).push(item);
  });
  return [left, right];
}

function InfoBlock({ item }: { item: MetadataInfoItem }) {
  return (
    <div className={`min-w-0 rounded-lg p-4 ${item.missing ? 'border border-[#eaeae6] bg-white' : 'bg-[#f5f5f2]'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#636360]">{item.label}</span>
        {item.missing ? <PriorityBadge priority={item.priority} /> : null}
      </div>
      <p className={`mt-1 break-words text-sm font-semibold ${item.missing ? 'text-[#9b9b97]' : 'text-[#111110]'}`}>{item.value}</p>
      <p className="mt-3 text-xs leading-5 text-[#636360]">{item.help}</p>
      {item.missing ? (
        <div className="group/fix mt-2 flex min-w-0 items-start gap-2 overflow-x-auto rounded-md bg-[#f5f5f2] p-2">
          <code className="min-w-max flex-1 whitespace-pre font-mono text-xs font-semibold leading-5 text-[#111110]">{item.fix}</code>
          <span className="shrink-0 opacity-0 transition group-hover/fix:opacity-100 group-focus-within/fix:opacity-100">
            <CopyButton value={item.fix} label={`Copy ${item.label} fix`} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: MetadataInfoItem['priority'] }) {
  const className = priority === 'Critical'
    ? 'bg-[#fee2e2] text-[#991b1b]'
    : priority === 'Recommended'
      ? 'bg-[#fef3c7] text-[#92400e]'
      : priority === 'Optional'
        ? 'bg-[#ebf2ff] text-brand-800'
        : 'bg-[#efefeb] text-[#636360]';

  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] ${className}`}>{priority}</span>;
}

function buildMetadataSnippets(preview: MetadataPreview) {
  const pageUrl = safeUrl(preview.url);
  const origin = pageUrl ? pageUrl.origin : 'https://example.com';
  const canonical = pageUrl ? pageUrl.toString() : preview.url;
  const domain = pageUrl ? pageUrl.hostname.replace(/^www\./, '') : 'example.com';
  const brand = brandName(preview, domain);
  const title = preview.metadata.title || brand;
  const description = preview.metadata.description || preview.metadata.ogDescription || `${title} from ${brand}.`;
  const image = preview.metadata.ogImage || preview.metadata.twitterImage || preview.images[0] || `${origin}/preview.jpg`;
  const keywordSource = [brand, ...title.split(/\s+/)]
    .map((value) => value.replace(/[^\w-]/g, '').trim().toLowerCase())
    .filter((value) => value.length > 2);
  const keywords = [...new Set(keywordSource)].slice(0, 6).join(', ') || `${brand.toLowerCase()}, ${domain}`;

  return {
    description: `<meta name="description" content="${escapeHtmlAttribute(description)}">`,
    canonical: `<link rel="canonical" href="${escapeHtmlAttribute(canonical)}">`,
    siteName: `<meta property="og:site_name" content="${escapeHtmlAttribute(brand)}">`,
    author: `<meta name="author" content="${escapeHtmlAttribute(brand)}">`,
    publisher: `<meta name="publisher" content="${escapeHtmlAttribute(brand)}">`,
    applicationName: `<meta name="application-name" content="${escapeHtmlAttribute(brand)}">`,
    favicon: `<link rel="icon" href="${escapeHtmlAttribute(`${origin}/favicon.ico`)}">`,
    manifest: `<link rel="manifest" href="${escapeHtmlAttribute(`${origin}/site.webmanifest`)}">`,
    ampUrl: `<link rel="amphtml" href="${escapeHtmlAttribute(`${origin}/amp${pageUrl?.pathname || '/'}`)}">`,
    ogType: `<meta property="og:type" content="${inferOgType(preview.url, title)}">`,
    ogUrl: `<meta property="og:url" content="${escapeHtmlAttribute(canonical)}">`,
    keywords: `<meta name="keywords" content="${escapeHtmlAttribute(keywords)}">`,
    structuredData: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: brand, url: origin })}</script>`,
    alternateLanguage: `<link rel="alternate" hreflang="en" href="${escapeHtmlAttribute(canonical)}">`,
    email: `<a href="mailto:hello@${escapeHtmlAttribute(domain)}">hello@${escapeHtmlAttribute(domain)}</a>`,
    socialProfile: `<a href="https://www.linkedin.com/company/${slugify(brand)}">LinkedIn</a>`,
    ogImage: `<meta property="og:image" content="${escapeHtmlAttribute(image)}">`
  };
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function brandName(preview: MetadataPreview, domain: string) {
  const candidate = preview.metadata.siteName
    || preview.metadata.applicationName
    || preview.metadata.ogTitle
    || preview.metadata.title
    || domain.split('.')[0]
    || 'Your Brand';
  return candidate.split(/[|–—-]/)[0]?.trim() || 'Your Brand';
}

function inferOgType(url: string, title: string) {
  const path = safeUrl(url)?.pathname.toLowerCase() || '';
  if (path.includes('/blog') || path.includes('/article') || path.includes('/news')) return 'article';
  if (path.includes('/product') || title.toLowerCase().includes('product')) return 'product';
  return 'website';
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'your-brand';
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
