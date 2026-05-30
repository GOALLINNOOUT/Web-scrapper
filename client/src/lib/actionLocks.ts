import { useSyncExternalStore } from 'react';

const locks = new Set<string>();
const listeners = new Set<() => void>();

export function useActionLock(key: string) {
  const isLocked = useSyncExternalStore(subscribe, () => locks.has(key));

  async function runLocked<T>(task: () => Promise<T>) {
    if (locks.has(key)) return undefined;

    locks.add(key);
    emit();
    try {
      return await task();
    } finally {
      locks.delete(key);
      emit();
    }
  }

  return { isLocked, runLocked };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  listeners.forEach((listener) => listener());
}
