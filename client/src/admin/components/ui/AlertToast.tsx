import { AlertTriangle } from 'lucide-react';
import type { AdminAlert } from '../../context/AdminContext.jsx';

export function AlertToast({ alert }: { alert?: AdminAlert }) {
  if (!alert) return null;
  return (
    <div className="admin-alert-toast">
      <AlertTriangle size={18} />
      <div>
        <strong>{alert.title}</strong>
        <span>{alert.description}</span>
      </div>
    </div>
  );
}
