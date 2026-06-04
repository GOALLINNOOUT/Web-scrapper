import { Bell, Clock, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin, type TimeRange } from '../../context/AdminContext.jsx';
import { AlertDrawer } from './AlertDrawer.jsx';

const healthTargets: Array<[string, string, string]> = [
  ['api', 'API', '/admin/infrastructure?tab=api'],
  ['workers', 'Workers', '/admin/infrastructure?tab=workers'],
  ['redis', 'Redis', '/admin/infrastructure?tab=redis'],
  ['mongodb', 'MongoDB', '/admin/infrastructure?tab=mongodb'],
  ['proxy_pool', 'Proxy Pool', '/admin/infrastructure?tab=proxy_pool'],
  ['queue', 'Queue', '/admin/crawling']
];

export function Header() {
  const { state, setRange, markAlertsSeen } = useAdmin();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header className="admin-header">
      <div className="admin-header-top">
        <div className="min-w-0" />
        <div className="flex items-center justify-end gap-2">
          <button className={`admin-alert-button ${state.unreadAlertCount > 0 ? 'admin-alert-button-unread' : 'admin-alert-button-seen'}`} type="button" onClick={() => {
            setDrawerOpen(true);
            markAlertsSeen();
          }} title={`${state.activeAlerts.length} active alerts`}>
            <Bell size={16} />
            {state.activeAlerts.length > 0 ? <span>{state.unreadAlertCount > 0 ? state.unreadAlertCount : state.activeAlerts.length}</span> : null}
          </button>
          <select className="admin-select" value={state.globalTimeRange} onChange={(event) => setRange(event.target.value as TimeRange)}>
            {['15m', '1h', '6h', '24h', '7d', '30d'].map((range) => <option key={range}>{range}</option>)}
          </select>
          <span className="hidden items-center gap-1 font-mono text-xs text-[var(--admin-text-secondary)] md:inline-flex"><Clock size={14} /> {clock.toISOString().slice(11, 19)} UTC</span>
          {state.socketConnected ? <Wifi className="text-[var(--accent-success)]" size={17} /> : <WifiOff className="text-[var(--accent-critical)]" size={17} />}
        </div>
      </div>
      <nav className="admin-health-strip">
        {healthTargets.map(([key, label, to]) => {
          const status = state.systemHealth[key] || 'Offline';
          return (
            <button key={key} type="button" className={`admin-health-pill admin-health-${status.toLowerCase()}`} onClick={() => navigate(to)} title={`${label}: ${status}`}>
              <span className="admin-health-dot" aria-hidden="true" />
              <span className="admin-health-label">{label}</span>
              <span className="admin-health-state">{status}</span>
            </button>
          );
        })}
      </nav>
      <AlertDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </header>
  );
}
