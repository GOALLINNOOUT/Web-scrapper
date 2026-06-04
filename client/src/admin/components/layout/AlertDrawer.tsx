import { X } from 'lucide-react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { age } from '../../utils/formatters.js';

export function AlertDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useAdmin();
  return (
    <aside className={`admin-alert-drawer ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex items-center justify-between border-b border-[var(--admin-border)] p-4">
        <strong>Active Alerts <span className="font-mono text-sm text-[var(--admin-text-secondary)]">({state.activeAlerts.length})</span></strong>
        <button className="admin-icon-btn" type="button" onClick={onClose} aria-label="Close alerts"><X size={18} /></button>
      </div>
      <div className="admin-alert-drawer-body">
        {state.activeAlerts.length === 0 ? <div className="admin-card text-sm text-[var(--admin-text-secondary)]">All systems operational</div> : null}
        {state.activeAlerts.map((alert) => (
          <article key={alert.alert_id} className={`admin-card border-l-4 ${alert.severity === 'critical' ? 'border-l-[var(--accent-critical)]' : 'border-l-[var(--accent-warning)]'}`}>
            <div className="flex items-center justify-between gap-2"><span className="admin-chip">{alert.severity}</span><span className="font-mono text-xs text-[var(--admin-text-secondary)]">{age(alert.timestamp)} ago</span></div>
            <h3 className="mt-3 text-sm font-semibold">{alert.title}</h3>
            <p className="mt-1 text-xs text-[var(--admin-text-secondary)]">{alert.description}</p>
            <dl className="mt-3 space-y-1 text-xs">
              {(alert.evidence || []).map((item) => <div key={item.metric} className="flex justify-between"><dt>{item.metric}</dt><dd className="font-mono">{item.value}{item.unit} / {item.threshold}{item.unit}</dd></div>)}
            </dl>
          </article>
        ))}
      </div>
    </aside>
  );
}
