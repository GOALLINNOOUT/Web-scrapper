interface CircuitState {
  failures: number;
  openedUntil: number;
}

const states = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_FAILURES || 5);
const OPEN_MS = Number(process.env.CIRCUIT_BREAKER_OPEN_MS || 60_000);

export function getCircuitBreaker(key: string) {
  const normalized = key.toLowerCase();
  const state = states.get(normalized) || { failures: 0, openedUntil: 0 };
  states.set(normalized, state);

  return {
    isOpen() {
      return Date.now() < state.openedUntil;
    },
    recordSuccess() {
      state.failures = 0;
      state.openedUntil = 0;
    },
    recordFailure() {
      state.failures += 1;
      if (state.failures >= FAILURE_THRESHOLD) {
        state.openedUntil = Date.now() + OPEN_MS;
      }
    }
  };
}
