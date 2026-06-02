import { Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function NetworkStatusBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    function handleOffline() {
      setOnline(false);
      setShowRestored(false);
    }
    function handleOnline() {
      setOnline(true);
      setShowRestored(true);
      window.setTimeout(() => setShowRestored(false), 2600);
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (online && !showRestored) return null;

  return (
    <div className={`fixed left-1/2 top-3 z-[2147483000] flex min-h-10 w-[min(420px,calc(100vw-28px))] -translate-x-1/2 items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold shadow-[0_16px_40px_rgba(0,0,0,0.16)] ${online ? 'border-[var(--success-light)] bg-[var(--success-light)] text-[var(--success)]' : 'border-[var(--danger-light)] bg-[var(--bg-base)] text-[var(--danger)]'}`}>
      {online ? <Wifi size={17} /> : <WifiOff size={17} />}
      <span>{online ? 'Connection restored.' : 'You are offline. Turn on Wi-Fi or mobile data, then retry.'}</span>
    </div>
  );
}
