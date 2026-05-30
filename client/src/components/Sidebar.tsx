import { Bell, ChevronsLeft, ChevronsRight, Database, Globe2, ListTree, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Overview', icon: DashboardMark },
  { to: '/crawls', label: 'Crawls', icon: ListTree },
  { to: '/domains', label: 'Domains', icon: Globe2 },
  { to: '/data', label: 'Data Explorer', icon: Database },
  { to: '/monitoring', label: 'Monitoring', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={`relative m-3 flex h-[calc(100vh-24px)] flex-col overflow-visible rounded-lg border border-[#eaeae6] bg-white py-5 text-[#111110] shadow-panel transition-all duration-300 ease-[var(--ease-out-expo)] max-[900px]:m-0 max-[900px]:h-auto max-[900px]:rounded-none max-[900px]:p-4 ${collapsed ? 'px-3' : 'px-4'}`}>
      <button
        className="absolute right-[-15px] top-8 z-20 hidden h-8 w-8 place-items-center rounded-full border border-[#eaeae6] bg-white text-[#636360] shadow-sm transition hover:border-[#c8c8c2] hover:bg-[#f5f5f2] hover:text-[#111110] max-[900px]:hidden min-[901px]:grid"
        type="button"
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>

      <div className={`mb-8 flex items-center gap-3 max-[900px]:hidden ${collapsed ? 'justify-center' : ''}`}>
        <PremiumLogo />
        {!collapsed ? <div className="min-w-0">
          <small className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9b9b97]">Command center</small>
          <strong className="block truncate text-lg font-semibold text-[#111110]">Web Intel</strong>
        </div> : null}
      </div>

      {!collapsed ? <span className="mb-3 ml-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9b9b97] max-[900px]:hidden">Main</span> : null}
      <nav className="grid gap-2 max-[900px]:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-md px-3 py-3 text-[15px] font-semibold transition max-[900px]:justify-center ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-[#ebf2ff] text-brand-800 shadow-[inset_3px_0_0_#0a6eff]' : 'text-[#636360] hover:bg-[#f5f5f2] hover:text-[#111110]'}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} />
              {!collapsed ? <span className="max-[900px]:hidden">{item.label}</span> : null}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

function PremiumLogo() {
  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#111110] text-white shadow-[0_12px_28px_rgba(17,17,16,0.20)]">
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_72%_22%,rgba(10,110,255,0.46),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.16),transparent_38%)]" />
      <span className="absolute bottom-2 left-2 h-1.5 w-1.5 rounded-full bg-[#0a6eff] shadow-[0_0_18px_rgba(10,110,255,0.9)]" />
      <span className="relative font-mono text-[18px] font-semibold tracking-[-0.02em]">WI</span>
    </span>
  );
}

function DashboardMark({ size = 18 }: { size?: number }) {
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute h-[72%] w-[72%] rounded-full border-2 border-current border-b-transparent border-l-transparent rotate-[-38deg]" />
      <span className="absolute bottom-[18%] h-[2px] w-[42%] origin-left rounded-full bg-current rotate-[-34deg]" />
    </span>
  );
}
