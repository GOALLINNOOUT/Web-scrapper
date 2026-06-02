import { LoaderCircle, Moon, Save, SlidersHorizontal, Sun, Monitor as SystemIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { LoadingState } from '../components/LoadingState.jsx';
import { showToast } from '../toast.js';
import { storeTheme } from '../theme.js';
import type { WorkspaceSettings } from '../types.js';

export function MobileSettings() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  if (!settings) return <div className="px-4"><LoadingState title="Loading settings" rows={5} /></div>;

  function update<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!settings) return;
    setIsSaving(true);
    try {
      const saved = await api.updateSettings(settings);
      setSettings(saved);
      storeTheme(saved.appearance.theme);
      showToast({ title: 'Settings saved', description: 'Mobile defaults updated.', tone: 'success' });
    } finally {
      setIsSaving(false);
    }
  }

  const crawling = settings.crawling;

  return (
    <div className="mobile-page-enter grid gap-5 px-4 pb-[128px] pt-2">
      <section>
        <h2 className="mobile-section-label !px-0">Appearance</h2>
        <div className="grid grid-cols-3 gap-2">
          {([
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
            ['system', 'System', SystemIcon]
          ] as Array<[WorkspaceSettings['appearance']['theme'], string, LucideIcon]>).map(([value, label, Icon]) => {
            const active = settings.appearance.theme === value;
            return (
              <button className={`mobile-setting-choice ${active ? 'mobile-setting-choice-active' : ''}`} key={String(value)} type="button" onClick={() => {
                storeTheme(value as WorkspaceSettings['appearance']['theme']);
                update('appearance', { ...settings.appearance, theme: value as WorkspaceSettings['appearance']['theme'] });
              }}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mobile-section-label !px-0">Crawling</h2>
        <div className="grid gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
          <MobileRange label="Default depth" min={1} max={10} value={crawling.defaultDepth} onChange={(value) => update('crawling', { ...crawling, defaultDepth: value })} />
          <MobileSelect label="Max pages" value={String(Math.min(5000, crawling.maxPages))} options={['100', '500', '1000', '5000']} onChange={(value) => update('crawling', { ...crawling, maxPages: Number(value) })} />
          <MobileRange label="Crawl delay" min={0} max={10} value={crawling.crawlDelaySeconds} onChange={(value) => update('crawling', { ...crawling, crawlDelaySeconds: value })} />
          <MobileToggle label="Respect robots.txt" checked={crawling.respectRobots} onChange={(checked) => update('crawling', { ...crawling, respectRobots: checked })} />
          <MobileSelect label="User agent" value={crawling.userAgentMode} options={['default', 'custom']} onChange={(value) => update('crawling', { ...crawling, userAgentMode: value as WorkspaceSettings['crawling']['userAgentMode'] })} />
          {crawling.userAgentMode === 'custom' ? <MobileText label="Custom user agent" value={crawling.customUserAgent} onChange={(value) => update('crawling', { ...crawling, customUserAgent: value })} /> : null}
        </div>
      </section>

      <button className="mobile-submit-btn mobile-tap" type="button" onClick={save} disabled={isSaving}>
        {isSaving ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}
        <span className="ml-2">{isSaving ? 'Saving' : 'Save Settings'}</span>
      </button>
    </div>
  );
}

function MobileRange({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const fill = ((value - min) / Math.max(1, max - min)) * 100;
  return (
    <label className="grid gap-2 border-b border-[var(--border-subtle)] py-3 last:border-b-0">
      <span className="flex items-center justify-between text-sm font-medium">{label}<strong className="font-mono text-[var(--accent)]">{value}</strong></span>
      <input className="mobile-range" min={min} max={max} type="range" value={value} style={{ background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${fill}%, var(--bg-sunken) ${fill}%, var(--bg-sunken) 100%)` }} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function MobileSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="grid gap-2 border-b border-[var(--border-subtle)] py-3 last:border-b-0"><span className="text-sm font-medium">{label}</span><select className="h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 text-sm font-semibold outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function MobileText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 border-b border-[var(--border-subtle)] py-3 last:border-b-0"><span className="text-sm font-medium">{label}</span><input className="h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 text-sm outline-none" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function MobileToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center justify-between border-b border-[var(--border-subtle)] py-3 last:border-b-0">
      <span className="text-sm font-medium">{label}</span>
      <input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-sunken)]'}`}><span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--bg-base)] shadow-sm transition ${checked ? 'translate-x-4' : ''}`} /></span>
    </label>
  );
}
