export type ToastTone = 'success' | 'error' | 'message';

export interface ToastPayload {
  title: string;
  description?: string;
  tone?: ToastTone;
}

export const TOAST_EVENT = 'web-intel-toast';

export function showToast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, {
    detail: {
      tone: 'message',
      ...payload
    }
  }));
}
