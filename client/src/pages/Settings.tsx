import { Bell, Bot, Building2, DatabaseZap, Lock, Monitor, MonitorCog, Moon, Palette, PlugZap, Save, ShieldCheck, SlidersHorizontal, Sun, UserRound, Users, Webhook } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.js';
import { LoadingState } from '../components/LoadingState.jsx';
import { showToast } from '../toast.js';
import { storeTheme } from '../theme.js';
import type { WorkspaceSettings } from '../types.js';

const sections = [
  { key: 'Account', icon: UserRound },
  { key: 'Workspace', icon: Building2 },
  { key: 'Notifications', icon: Bell },
  { key: 'Crawling', icon: Bot },
  { key: 'Monitoring', icon: MonitorCog },
  { key: 'Data', icon: DatabaseZap },
  { key: 'Integrations', icon: PlugZap },
  { key: 'Appearance', icon: Palette }
] as const;

export function Settings() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [active, setActive] = useState<typeof sections[number]['key']>('Account');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  if (!settings) return <LoadingState title="Loading workspace settings" rows={7} />;

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
      showToast({ title: 'Settings saved', description: 'Workspace defaults updated.', tone: 'success' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6">
      <header className="flex items-end justify-between gap-4 max-[760px]:grid">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-brand-600">Settings</span>
          <h1 className="command-heading mt-2 text-[40px] font-extrabold leading-tight max-[900px]:text-3xl">Workspace control center</h1>
          <p className="mt-2 max-w-3xl text-[16px] text-[#636360]">Defaults for crawling, monitoring, notifications, retention, integrations, and interface behavior.</p>
        </div>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-extrabold text-white hover:bg-brand-700 disabled:opacity-60" onClick={save} disabled={isSaving} type="button"><Save size={16} /> {isSaving ? 'Saving' : 'Save'}</button>
      </header>

      <div className="grid grid-cols-[230px_minmax(0,1fr)] gap-5 max-[900px]:grid-cols-1">
        <nav className="grid h-fit gap-2 rounded-lg border border-[#eaeae6] bg-white p-3 shadow-panel max-[900px]:grid-cols-4 max-[640px]:grid-cols-2">
          {sections.map(({ key, icon: Icon }) => (
            <button className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-extrabold transition ${active === key ? 'bg-brand-600 text-white shadow-[0_10px_24px_rgba(59,130,246,0.24)]' : 'text-[#636360] hover:bg-[#f5f5f2]'}`} key={key} onClick={() => setActive(key)} type="button">
              <Icon size={16} />
              <span>{key}</span>
            </button>
          ))}
        </nav>

        <main className="grid gap-5">
          {active === 'Account' ? <Panel icon={Lock} title="Account"><DisabledAccount settings={settings} update={update} /></Panel> : null}
          {active === 'Workspace' ? <Panel icon={Users} title="Workspace"><WorkspaceSection settings={settings} update={update} /></Panel> : null}
          {active === 'Notifications' ? <Panel icon={Bell} title="Notifications"><NotificationsSection settings={settings} update={update} /></Panel> : null}
          {active === 'Crawling' ? <Panel icon={SlidersHorizontal} title="Crawling defaults"><CrawlingSection settings={settings} update={update} /></Panel> : null}
          {active === 'Monitoring' ? <Panel icon={MonitorCog} title="Monitoring defaults"><MonitoringSection settings={settings} update={update} /></Panel> : null}
          {active === 'Data' ? <Panel icon={DatabaseZap} title="Data & retention"><DataSection settings={settings} update={update} /></Panel> : null}
          {active === 'Integrations' ? <Panel icon={Webhook} title="Integrations"><IntegrationsSection settings={settings} update={update} /></Panel> : null}
          {active === 'Appearance' ? <Panel icon={Palette} title="Appearance"><AppearanceSection settings={settings} update={update} /></Panel> : null}
        </main>
      </div>
    </div>
  );
}

function DisabledAccount({ settings, update }: SectionProps) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
        <TextInput label="Name" value={settings.account.name} onChange={(value) => update('account', { ...settings.account, name: value })} />
        <TextInput label="Email" value={settings.account.email} onChange={(value) => update('account', { ...settings.account, email: value })} />
      </div>
      <DisabledRow icon={ShieldCheck} title="Password, profile image, and 2FA" body="These controls are ready for authenticated accounts and will activate when user login is added." />
    </div>
  );
}

function WorkspaceSection({ settings, update }: SectionProps) {
  return (
    <div className="grid gap-4">
      <TextInput label="Workspace name" value={settings.workspace.name} onChange={(value) => update('workspace', { ...settings.workspace, name: value })} />
      <DisabledRow icon={Users} title="Members and roles" body="Owner, Admin, Member, and Viewer roles are reserved for the auth-backed workspace phase." />
    </div>
  );
}

function NotificationsSection({ settings, update }: SectionProps) {
  const events = settings.notifications.events;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
        <Select label="In-app alerts" value={settings.notifications.inApp} options={['all', 'important', 'disabled']} onChange={(value) => update('notifications', { ...settings.notifications, inApp: value as WorkspaceSettings['notifications']['inApp'] })} />
        <Select label="Email cadence" value={settings.notifications.email} options={['instant', 'daily', 'weekly', 'disabled']} onChange={(value) => update('notifications', { ...settings.notifications, email: value as WorkspaceSettings['notifications']['email'] })} />
      </div>
      <ToggleGrid items={[
        ['Pricing changes', events.pricingChanges, (checked) => update('notifications', { ...settings.notifications, events: { ...events, pricingChanges: checked } })],
        ['Email discoveries', events.emailDiscoveries, (checked) => update('notifications', { ...settings.notifications, events: { ...events, emailDiscoveries: checked } })],
        ['DNS changes', events.dnsChanges, (checked) => update('notifications', { ...settings.notifications, events: { ...events, dnsChanges: checked } })],
        ['WHOIS changes', events.whoisChanges, (checked) => update('notifications', { ...settings.notifications, events: { ...events, whoisChanges: checked } })],
        ['Tech stack changes', events.techStackChanges, (checked) => update('notifications', { ...settings.notifications, events: { ...events, techStackChanges: checked } })],
        ['New pages', events.newPages, (checked) => update('notifications', { ...settings.notifications, events: { ...events, newPages: checked } })]
      ]} />
    </div>
  );
}

function CrawlingSection({ settings, update }: SectionProps) {
  const crawling = settings.crawling;
  return (
    <div className="grid gap-5">
      <Range label="Default depth" min={1} max={5} value={crawling.defaultDepth} onChange={(value) => update('crawling', { ...crawling, defaultDepth: value })} />
      <Select label="Max pages" value={String(crawling.maxPages)} options={['100', '500', '1000', '5000']} onChange={(value) => update('crawling', { ...crawling, maxPages: Number(value) })} />
      <Select label="Crawl delay" value={String(crawling.crawlDelaySeconds)} options={['1', '2', '5']} onChange={(value) => update('crawling', { ...crawling, crawlDelaySeconds: Number(value) })} />
      <Toggle label="Respect robots.txt" checked={crawling.respectRobots} onChange={(checked) => update('crawling', { ...crawling, respectRobots: checked })} />
      <Select label="User agent" value={crawling.userAgentMode} options={['default', 'custom']} onChange={(value) => update('crawling', { ...crawling, userAgentMode: value as WorkspaceSettings['crawling']['userAgentMode'] })} />
      {crawling.userAgentMode === 'custom' ? <TextInput label="Custom user agent" value={crawling.customUserAgent} onChange={(value) => update('crawling', { ...crawling, customUserAgent: value })} /> : null}
    </div>
  );
}

function MonitoringSection({ settings, update }: SectionProps) {
  const monitoring = settings.monitoring;
  return (
    <div className="grid gap-5">
      <Select label="Monitoring preset" value={monitoring.preset} options={['competitive_intelligence', 'lead_discovery', 'seo_monitoring', 'infrastructure_monitoring', 'custom']} onChange={(value) => update('monitoring', { ...monitoring, preset: value as WorkspaceSettings['monitoring']['preset'] })} />
      <Select label="Default frequency" value={monitoring.defaultFrequency} options={['daily', 'weekly', 'monthly']} onChange={(value) => update('monitoring', { ...monitoring, defaultFrequency: value as WorkspaceSettings['monitoring']['defaultFrequency'] })} />
      <Toggle label="Auto-monitor important pages" checked={monitoring.autoMonitorImportantPages} onChange={(checked) => update('monitoring', { ...monitoring, autoMonitorImportantPages: checked })} />
      <Select label="Sensitivity" value={monitoring.sensitivity} options={['low', 'medium', 'high']} onChange={(value) => update('monitoring', { ...monitoring, sensitivity: value as WorkspaceSettings['monitoring']['sensitivity'] })} />
    </div>
  );
}

function DataSection({ settings, update }: SectionProps) {
  const dataRetention = settings.dataRetention;
  return (
    <div className="grid gap-5">
      <Select label="Retention policy" value={String(dataRetention.retentionDays)} options={['30', '90', '180', '365']} onChange={(value) => update('dataRetention', { ...dataRetention, retentionDays: Number(value) as WorkspaceSettings['dataRetention']['retentionDays'] })} />
      <Toggle label="Auto-delete old data" checked={dataRetention.autoDelete} onChange={(checked) => update('dataRetention', { ...dataRetention, autoDelete: checked })} />
      <Select label="Export format" value={dataRetention.exportFormat} options={['csv', 'json']} onChange={(value) => update('dataRetention', { ...dataRetention, exportFormat: value as WorkspaceSettings['dataRetention']['exportFormat'] })} />
    </div>
  );
}

function IntegrationsSection({ settings, update }: SectionProps) {
  const integrations = settings.integrations;
  return (
    <div className="grid gap-4">
      <TextInput label="Webhook URL" value={integrations.webhookUrl} onChange={(value) => update('integrations', { ...integrations, webhookUrl: value })} />
      <TextInput label="Webhook secret" value={integrations.webhookSecret} onChange={(value) => update('integrations', { ...integrations, webhookSecret: value })} />
      <DisabledRow icon={Webhook} title="Slack, HubSpot, Airtable, Zapier, Make" body="Future integrations are reserved while webhook configuration becomes the first integration surface." />
    </div>
  );
}

function AppearanceSection({ settings, update }: SectionProps) {
  function updateTheme(value: WorkspaceSettings['appearance']['theme']) {
    storeTheme(value);
    update('appearance', { ...settings.appearance, theme: value });
  }

  return (
    <div className="grid gap-5">
      <ThemeSelector value={settings.appearance.theme} onChange={updateTheme} />
      <Select label="Density" value={settings.appearance.density} options={['comfortable', 'compact']} onChange={(value) => update('appearance', { ...settings.appearance, density: value as WorkspaceSettings['appearance']['density'] })} />
    </div>
  );
}

interface SectionProps {
  settings: WorkspaceSettings;
  update: <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => void;
}

function Panel({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#eaeae6] bg-white p-6 shadow-panel">
      <div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-[#ebf2ff] text-brand-700"><Icon size={20} /></span><h2 className="text-2xl font-extrabold">{title}</h2></div>
      {children}
    </section>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2"><span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">{label}</span><input className="h-11 rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-3 text-sm font-semibold outline-none focus:border-brand-500 focus:bg-white" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="grid gap-2"><span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">{label}</span><select className="h-11 rounded-lg border border-[#eaeae6] bg-[#f5f5f2] px-3 text-sm font-bold outline-none focus:border-brand-500 focus:bg-white" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}</select></label>;
}

function Range({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) {
  return <label className="grid gap-2 rounded-lg bg-[#f5f5f2] p-4"><span className="flex items-center justify-between text-sm font-bold text-[#636360]">{label}<strong className="text-[#111110]">{value}</strong></span><input className="accent-brand-600" type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-[#f5f5f2] p-4"><span className="text-sm font-extrabold">{label}</span><input className="h-5 w-5 accent-brand-600" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function ToggleGrid({ items }: { items: Array<[string, boolean, (checked: boolean) => void]> }) {
  return <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">{items.map(([label, checked, onChange]) => <Toggle key={label} label={label} checked={checked} onChange={onChange} />)}</div>;
}

function ThemeSelector({ value, onChange }: { value: WorkspaceSettings['appearance']['theme']; onChange: (value: WorkspaceSettings['appearance']['theme']) => void }) {
  const modes: Array<{ value: WorkspaceSettings['appearance']['theme']; label: string; body: string; icon: LucideIcon }> = [
    { value: 'light', label: 'Light', body: 'Clean daylight workspace', icon: Sun },
    { value: 'dark', label: 'Dark', body: 'Low-glare command center', icon: Moon },
    { value: 'system', label: 'System', body: 'Follow device preference', icon: Monitor }
  ];

  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#636360]">Color mode</legend>
      <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
        {modes.map(({ value: mode, label, body, icon: Icon }) => {
          const active = value === mode;
          return (
            <button
              aria-pressed={active}
              className={`group relative min-h-[118px] overflow-hidden rounded-lg border p-4 text-left transition duration-300 ${active ? 'border-brand-300 bg-[#ebf2ff] text-brand-800 shadow-[0_18px_34px_rgba(10,110,255,0.16)]' : 'border-[#eaeae6] bg-[#f5f5f2] text-[#636360] hover:border-[#c8c8c2] hover:bg-white hover:text-[#111110]'}`}
              key={mode}
              onClick={() => onChange(mode)}
              type="button"
            >
              <span className={`mb-4 grid h-10 w-10 place-items-center rounded-lg transition ${active ? 'bg-brand-600 text-white shadow-[0_10px_24px_rgba(10,110,255,0.24)]' : 'bg-white text-brand-700 group-hover:bg-[#ebf2ff]'}`}>
                <Icon size={19} />
              </span>
              <strong className="block text-sm font-extrabold">{label}</strong>
              <small className="mt-1 block text-xs font-bold leading-relaxed text-[#636360]">{body}</small>
              {active ? <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-brand-600 shadow-[0_0_18px_rgba(10,110,255,0.7)]" /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function DisabledRow({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return <div className="flex items-start gap-3 rounded-lg bg-[#f5f5f2] p-4 opacity-75"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#636360]"><Icon size={18} /></span><span><strong className="block">{title}</strong><small className="mt-1 block text-sm font-semibold text-[#636360]">{body}</small></span></div>;
}

function formatLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
