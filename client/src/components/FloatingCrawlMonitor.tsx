import { Grip, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveRefresh } from '../hooks/useLiveEvents.js';
import { applyLiveJobPatch, parseLiveCrawlJob, parseLiveCrawlJobSnapshot, parseLiveCrawlPage } from '../lib/liveCrawl.js';
import type { CrawlJob } from '../types.js';
import { CrawlActionButtons } from './CrawlActionButtons.jsx';
import { CrawlStatusBadge } from './CrawlStatusBadge.jsx';

const POSITION_KEY = 'web-intel-floating-crawl-position';
const EDGE_PADDING = 12;
const DEFAULT_WIDTH = 320;
const MIN_VISIBLE_HEIGHT = 96;

interface FloatingCrawlMonitorProps {
  onCrawlChange?: () => void;
}

export function FloatingCrawlMonitor({ onCrawlChange }: FloatingCrawlMonitorProps) {
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ x: 0, y: 0, left: 0, top: 0, dragging: false });
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [position, setPosition] = useState(() => loadPosition());
  const [minimized, setMinimized] = useState(false);

  async function load() {
    const jobs = await api.listCrawls();
    setJob(jobs.find((item) => isActiveCrawl(item)) || null);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (location.pathname !== '/') {
      load().catch(console.error);
    }
  }, [location.pathname]);

  useLiveRefresh((event) => {
    const payload = parseLiveCrawlPage(event);
    if (payload) {
      setJob((current) => {
        if (!current) {
          void load().catch(console.error);
          return current;
        }
        if (current._id !== event.crawlId) return current;
        return applyLiveJobPatch(current, payload.job);
      });
      return;
    }
    const jobPatch = parseLiveCrawlJob(event);
    if (jobPatch) {
      const snapshot = parseLiveCrawlJobSnapshot(event);
      setJob((current) => {
        if (!current && snapshot && isActiveCrawl(snapshot)) return snapshot;
        if (!current) {
          void load().catch(console.error);
          return current;
        }
        if (current._id !== event.crawlId) return current;
        return applyLiveJobPatch(current, jobPatch);
      });
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  }, [position]);

  useEffect(() => {
    function clampToViewport() {
      setPosition((current) => clampPosition(current, cardRef.current));
    }

    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [job, minimized]);

  if (!job || !isActiveCrawl(job) || location.pathname === '/') return null;

  const progress = getProgress(job);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      dragging: true
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging) return;
    setPosition(clampPosition({
      left: dragRef.current.left + event.clientX - dragRef.current.x,
      top: dragRef.current.top + event.clientY - dragRef.current.y
    }, cardRef.current));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current.dragging = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      ref={cardRef}
      className="fixed z-40 w-[min(320px,calc(100vw-24px))] max-w-[calc(100vw-24px)] overflow-hidden rounded-[26px] border border-[#c8c8c2] bg-white shadow-[0_28px_80px_rgba(11,15,13,0.18)]"
      style={{ left: position.left, top: position.top }}
    >
      <div
        className="flex cursor-grab touch-none items-center justify-between gap-3 bg-[#f5f5f2] px-4 py-3 active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <span className="inline-flex items-center gap-2 text-sm font-extrabold text-[#636360]"><Grip size={15} /> Crawl monitor</span>
        <button
          className="grid h-8 w-8 place-items-center rounded-full bg-white text-[#636360] shadow-sm transition hover:text-brand-800"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMinimized((value) => !value)}
          title={minimized ? 'Expand monitor' : 'Minimize monitor'}
        >
          {minimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
        </button>
      </div>

      {!minimized ? (
        <div className="grid min-w-0 gap-4 overflow-hidden p-4">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="min-w-0">
              <strong className="block max-w-full truncate text-sm" title={job.seedUrl}>{job.seedUrl}</strong>
              <span className="mt-1 block text-xs font-semibold text-[#636360]">{getProgressText(job)}</span>
            </div>
            <span className="max-w-[94px] overflow-hidden"><CrawlStatusBadge status={job.status} /></span>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs font-extrabold text-[#636360]">
              <span>{job.status === 'running' ? 'Limit used' : 'Progress'}</span>
              <span>{job.status === 'completed' ? '100%' : `${progress}%`}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#e8e8e4]">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-3 gap-2">
            <MiniMetric label="Emails" value={job.emailsFound} />
            <MiniMetric label="Socials" value={job.socialLinksFound} />
            <MiniMetric label="Depth" value={job.config?.maxDepth || 0} />
          </div>

          {['queued', 'running', 'paused'].includes(job.status) ? <CrawlActionButtons job={job} onChange={async () => {
            await load();
            await onCrawlChange?.();
          }} compact /> : null}

          <Link className="inline-flex min-h-10 max-w-full items-center justify-center truncate rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white transition hover:bg-brand-700" to={`/crawls/${job._id}`}>
            View crawl detail
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function isActiveCrawl(job: CrawlJob) {
  return ['queued', 'running', 'paused'].includes(job.status);
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#f5f5f2] p-3">
      <span className="block text-[11px] font-bold text-[#636360]">{label}</span>
      <strong className="text-lg">{value}</strong>
    </div>
  );
}

function loadPosition() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(POSITION_KEY) || '');
    if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') return clampPosition(parsed as { left: number; top: number });
  } catch {
    // Use default position.
  }
  return clampPosition({ left: window.innerWidth - DEFAULT_WIDTH - 32, top: 132 });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function clampPosition(position: { left: number; top: number }, card?: HTMLDivElement | null) {
  const width = card?.offsetWidth || Math.min(DEFAULT_WIDTH, window.innerWidth - EDGE_PADDING * 2);
  const height = card?.offsetHeight || MIN_VISIBLE_HEIGHT;
  return {
    left: clamp(position.left, EDGE_PADDING, window.innerWidth - width - EDGE_PADDING),
    top: clamp(position.top, EDGE_PADDING, window.innerHeight - Math.min(height, MIN_VISIBLE_HEIGHT) - EDGE_PADDING)
  };
}

function getProgress(job: CrawlJob) {
  if (job.status === 'completed') return 100;
  if (job.status === 'failed') return 0;
  return Math.min(100, Math.round((job.pagesCrawled / Math.max(1, job.config?.maxPages || 1)) * 100));
}

function getProgressText(job: CrawlJob) {
  if (job.status === 'completed') return `${job.pagesCrawled} pages - complete`;
  if (job.status === 'stopped') return `Stopped at ${job.pagesCrawled} pages`;
  if (job.status === 'failed') return 'Crawl failed';
  return `${job.pagesCrawled} / ${job.config?.maxPages || 0} page limit`;
}
