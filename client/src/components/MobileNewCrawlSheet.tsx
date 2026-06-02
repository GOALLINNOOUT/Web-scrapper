import { Check, LoaderCircle, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { normalizeSeedUrl } from '../lib/seedUrl.js';
import { showToast } from '../toast.js';
import type { CrawlConfig, CrawlJob } from '../types.js';

interface MobileNewCrawlSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (job: CrawlJob) => void;
}

const maxPagesMin = 100;
const maxPagesMax = 5000;

export function MobileNewCrawlSheet({ open, onClose, onCreated }: MobileNewCrawlSheetProps) {
  const panelRef = useRef<HTMLFormElement>(null);
  const dragRef = useRef({ startY: 0, startedAt: 0, currentY: 0, dragging: false });
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(5000);
  const [sameDomainOnly, setSameDomainOnly] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [extractEmails, setExtractEmails] = useState(true);
  const [extractSocials, setExtractSocials] = useState(true);
  const [detectTechStack, setDetectTechStack] = useState(true);
  const [screenshots, setScreenshots] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const normalizedUrl = useMemo(() => normalizeSeedUrl(url), [url]);
  const hasTyped = url.trim().length > 0;
  const isInvalid = hasTyped && !normalizedUrl;

  useEffect(() => {
    if (!open) return;
    api.getSettings()
      .then((settings) => {
        setDepth(settings.crawling.defaultDepth || 3);
        setMaxPages(Math.min(maxPagesMax, settings.crawling.maxPages || 5000));
        setRespectRobots(settings.crawling.respectRobots);
      })
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  async function startCrawl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedUrl) {
      showToast({
        title: 'Invalid crawl target',
        description: 'Enter a valid website, for example example.com or https://example.com',
        tone: 'error'
      });
      return;
    }

    setIsStarting(true);
    try {
      const job = await api.createCrawl({
        seedUrl: normalizedUrl,
        maxDepth: depth,
        maxPages,
        sameDomainOnly,
        respectRobots,
        concurrency: 5,
        schedule: 'none',
        discovery: {
          sitemap: true,
          renderJavaScript: true,
          renderWhenStaticLinksBelow: 20,
          includeMetaLinks: true
        },
        extract: {
          links: true,
          emails: extractEmails,
          metadata: true,
          social: extractSocials,
          content: true
        }
      });
      navigator.vibrate?.([10]);
      showToast({ title: 'Crawl started', description: normalizedUrl, tone: 'success' });
      setUrl('');
      onCreated?.(job);
      onClose();
    } finally {
      setIsStarting(false);
    }
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { startY: event.clientY, currentY: event.clientY, startedAt: performance.now(), dragging: true };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging || !panelRef.current) return;
    const delta = Math.max(0, event.clientY - dragRef.current.startY);
    dragRef.current.currentY = event.clientY;
    panelRef.current.style.transform = `translateY(${delta}px)`;
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!panelRef.current) return;
    const delta = Math.max(0, dragRef.current.currentY - dragRef.current.startY);
    const elapsed = Math.max(1, performance.now() - dragRef.current.startedAt);
    const velocity = (delta / elapsed) * 1000;
    dragRef.current.dragging = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    panelRef.current.style.transform = '';

    if (velocity > 500 || delta > window.innerHeight * 0.35) {
      onClose();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-labelledby="new-crawl-title">
      <button className="mobile-sheet-overlay absolute inset-0 w-full" type="button" aria-label="Close new crawl" onClick={onClose} />
      <form className="mobile-sheet-panel absolute bottom-0 left-0 right-0" onSubmit={startCrawl} ref={panelRef}>
        <div
          className="touch-none py-3"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        >
          <span className="mx-auto block h-1 w-9 rounded-full bg-[var(--border-default)]" />
        </div>

        <div className="no-scrollbar h-[calc(88vh-78px)] overflow-y-auto px-5 pb-28">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="new-crawl-title" className="text-xl font-semibold text-[var(--text-primary)]">New Crawl</h2>
            <button className="mobile-icon-btn" type="button" aria-label="Close new crawl" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <label className="grid gap-2">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Start URL</span>
            <span className={`grid h-[46px] grid-cols-[auto_minmax(0,1fr)_24px] items-center gap-0 rounded-[10px] border bg-[var(--bg-raised)] px-3 font-mono text-sm transition ${isInvalid ? 'border-[var(--danger)]' : 'border-[var(--border-default)] focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_rgba(10,110,255,0.15)]'}`}>
              <span className="text-[var(--text-tertiary)]">https://</span>
              <input
                className="min-w-0 border-0 bg-transparent py-3 text-[var(--text-primary)] outline-none"
                inputMode="url"
                autoComplete="url"
                value={url}
                onChange={(event) => setUrl(event.target.value.replace(/^https?:\/\//i, ''))}
                placeholder="example.com"
              />
              {normalizedUrl ? <Check className="text-[var(--success)] transition" size={17} /> : null}
              {isInvalid ? <X className="text-[var(--danger)] transition" size={17} /> : null}
            </span>
            {isInvalid ? <span className="text-xs font-medium text-[var(--danger)]">Enter a valid domain or URL.</span> : null}
          </label>

          <div className="mt-6 grid gap-5">
            <Slider label="Depth" value={depth} display={String(depth)} min={1} max={10} onChange={setDepth} />
            <Slider
              label="Max Pages"
              value={maxPagesToSlider(maxPages)}
              display={maxPages.toLocaleString()}
              min={0}
              max={100}
              onChange={(value) => setMaxPages(sliderToMaxPages(value))}
            />
          </div>

          <div className="mt-6 grid gap-1">
            <Toggle label="Same domain only" checked={sameDomainOnly} onChange={setSameDomainOnly} />
            <Toggle label="Respect robots.txt" checked={respectRobots} onChange={setRespectRobots} />
            <Toggle label="Extract emails" checked={extractEmails} onChange={setExtractEmails} />
            <Toggle label="Extract socials" checked={extractSocials} onChange={setExtractSocials} />
            <Toggle label="Detect tech stack" checked={detectTechStack} onChange={setDetectTechStack} />
            <Toggle label="Screenshots" checked={screenshots} onChange={setScreenshots} disabled />
          </div>

        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
          <button className="mobile-submit-btn mobile-tap" type="submit" disabled={isStarting}>
            <span className="inline-grid min-w-24 place-items-center">
              {isStarting ? <LoaderCircle className="animate-spin" size={18} /> : 'Start Crawl'}
            </span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function Slider({ label, value, display, min, max, onChange }: { label: string; value: number; display: string; min: number; max: number; onChange: (value: number) => void }) {
  const fill = ((value - min) / Math.max(1, max - min)) * 100;
  return (
    <label className="grid gap-3">
      <span className="flex items-center justify-between text-[13px] font-medium text-[var(--text-primary)]">
        {label}
        <strong className="font-mono text-[var(--accent)]">{display}</strong>
      </span>
      <input
        className="mobile-range"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${fill}%, var(--bg-sunken) ${fill}%, var(--bg-sunken) 100%)` }}
        type="range"
        value={value}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex min-h-12 items-center justify-between gap-3 ${disabled ? 'opacity-55' : ''}`}>
      <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
      <input className="sr-only" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={`relative h-5 w-9 rounded-full transition duration-200 ease-[var(--expo)] ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-sunken)]'}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--bg-base)] shadow-sm transition duration-200 ease-[var(--expo)] ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </label>
  );
}

function sliderToMaxPages(value: number) {
  const minLog = Math.log(maxPagesMin);
  const maxLog = Math.log(maxPagesMax);
  const raw = Math.exp(minLog + (value / 100) * (maxLog - minLog));
  const step = raw < 1000 ? 100 : 500;
  return Math.round(raw / step) * step;
}

function maxPagesToSlider(value: number) {
  const minLog = Math.log(maxPagesMin);
  const maxLog = Math.log(maxPagesMax);
  const clamped = Math.min(maxPagesMax, Math.max(maxPagesMin, value));
  return Math.round(((Math.log(clamped) - minLog) / (maxLog - minLog)) * 100);
}
