import { useAdmin } from '../context/AdminContext.jsx';

export function useTimeRange() {
  const { state, setRange } = useAdmin();
  const now = new Date();
  return {
    range: state.globalTimeRange,
    setRange,
    dateRange: { from: null as Date | null, to: now }
  };
}
