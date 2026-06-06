import { AlertTriangle, BarChart3, ChevronsLeft, ChevronsRight, LayoutGrid, Network, Radar, Server, TrendingUp } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAdmin } from '../../context/AdminContext.jsx';

const items = [
  { to: '/admin', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/admin/infrastructure', label: 'Infrastructure', icon: Server },
  { to: '/admin/crawling', label: 'Crawling', icon: Network },
  { to: '/admin/failures', label: 'Failures', icon: AlertTriangle },
  { to: '/admin/capacity', label: 'Capacity', icon: TrendingUp }
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { state } = useAdmin();
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-top">
        <div className="admin-sidebar-brand">
          <span className="admin-radar"><Radar size={18} /></span>
          <strong className="admin-sidebar-brand-text">WEBSCRAPER OPS</strong>
        </div>
        <button className="admin-sidebar-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
      <nav className="space-y-1">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} title={collapsed ? label : undefined} className={({ isActive }) => `admin-nav-link ${isActive ? 'admin-nav-link-active' : ''}`}>
            <Icon size={18} />
            <span className="admin-nav-label">{label}</span>
            {label === 'Failures' && state.activeAlerts.length ? <em>{state.activeAlerts.length}</em> : null}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-2 text-xs text-[var(--admin-text-secondary)]">
        <div className="admin-sidebar-meta"><BarChart3 size={15} /> <span>Uptime</span> <span className="font-mono">{formatUptime(state.latestMetric?.api?.uptime_seconds)}</span></div>
        <span className="admin-sidebar-version font-mono">v1.0 ops</span>
      </div>
    </aside>
  );
}

function formatUptime(value: unknown) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'n/a';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}
