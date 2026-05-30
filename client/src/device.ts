const DEVICE_STORAGE_KEY = 'web-intel-device-id';
export const LEGACY_DEVICE_ID = 'legacy-local-device';

export function getDeviceId() {
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) return existing;

  const generated = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(DEVICE_STORAGE_KEY, generated);
  return generated;
}

export function getDeviceSuffix(deviceId = getDeviceId()) {
  return deviceId.slice(-6).toUpperCase();
}

export function resetDeviceWorkspace() {
  window.localStorage.removeItem(DEVICE_STORAGE_KEY);
  return getDeviceId();
}
