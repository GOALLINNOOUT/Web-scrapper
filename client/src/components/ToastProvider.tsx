import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TOAST_EVENT, type ToastPayload, type ToastTone } from '../toast.js';

interface ToastItem extends ToastPayload {
  id: string;
  tone: ToastTone;
}

const icons = {
  success: CheckCircle2,
  error: XCircle,
  message: Info
};

const labels = {
  success: 'Success',
  error: 'Attention',
  message: 'Update'
};

const toneStyles = {
  success: {
    shell: 'border-emerald-200/80',
    rail: 'bg-emerald-500',
    icon: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    label: 'text-emerald-700',
    bar: 'bg-emerald-500'
  },
  error: {
    shell: 'border-red-200/80',
    rail: 'bg-red-500',
    icon: 'bg-red-50 text-red-700 ring-red-100',
    label: 'text-red-700',
    bar: 'bg-red-500'
  },
  message: {
    shell: 'border-[#dbe7ff]',
    rail: 'bg-brand-600',
    icon: 'bg-[#ebf2ff] text-brand-700 ring-[#dbe7ff]',
    label: 'text-brand-700',
    bar: 'bg-brand-600'
  }
} satisfies Record<ToastTone, { shell: string; rail: string; icon: string; label: string; bar: string }>;

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function handleToast(event: Event) {
      const payload = (event as CustomEvent<ToastPayload>).detail;
      const toast: ToastItem = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        tone: payload.tone || 'message',
        title: payload.title,
        description: payload.description
      };

      setToasts((current) => [...current.slice(-3), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 4200);
    }

    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  return (
    <div className="fixed right-5 top-5 z-50 grid w-[min(430px,calc(100vw-28px))] gap-3 max-[640px]:left-3.5 max-[640px]:right-3.5 max-[640px]:top-3.5 max-[640px]:w-auto" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = icons[toast.tone];
        const tone = toneStyles[toast.tone];
        return (
          <div className={`toast-enter relative grid grid-cols-[4px_36px_minmax(0,1fr)_30px] items-start gap-3 overflow-hidden rounded-lg border bg-white shadow-[0_24px_70px_rgba(17,17,16,0.16)] ${tone.shell}`} key={toast.id}>
            <span className={`h-full min-h-[86px] ${tone.rail}`} />
            <span className={`mt-4 grid h-9 w-9 place-items-center rounded-md ring-1 ${tone.icon}`}>
              <Icon size={18} />
            </span>
            <div className="min-w-0 py-4 pr-1">
              <span className={`text-[11px] font-extrabold uppercase tracking-[0.14em] ${tone.label}`}>{labels[toast.tone]}</span>
              <strong className="mt-1 block break-words text-[15px] font-extrabold leading-5 text-[#111110]">{toast.title}</strong>
              {toast.description ? <span className="mt-1.5 block break-words text-xs font-semibold leading-5 text-[#636360]">{toast.description}</span> : null}
            </div>
            <button className="mr-3 mt-3 grid h-7 w-7 place-items-center rounded-md bg-[#f5f5f2] text-[#636360] transition hover:bg-[#efefeb] hover:text-[#111110]" type="button" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>
              <X size={14} />
            </button>
            <span className={`toast-progress absolute bottom-0 left-0 h-1 ${tone.bar}`} />
          </div>
        );
      })}
    </div>
  );
}
