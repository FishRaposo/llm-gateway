/** Circuit breaker with CLOSED / OPEN / HALF_OPEN state machine. */

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface ProviderCircuitState {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  lastFailureTime: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold?: number;
  resetTimeoutMs: number;
}

const circuitMap = new Map<string, ProviderCircuitState>();

function getState(provider: string): ProviderCircuitState {
  if (!circuitMap.has(provider)) {
    circuitMap.set(provider, {
      state: "CLOSED",
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
    });
  }
  return circuitMap.get(provider)!;
}

/**
 * Checks whether a provider is currently available for requests.
 * Returns false if the breaker is OPEN and the timeout hasn't elapsed.
 */
export function isAvailable(provider: string, config: CircuitBreakerConfig): boolean {
  const state = getState(provider);

  if (state.state === "CLOSED") {
    return true;
  }

  if (state.state === "OPEN") {
    if (Date.now() - state.lastFailureTime >= config.resetTimeoutMs) {
      state.state = "HALF_OPEN";
      state.failures = 0;
      state.successes = 0;
      return true;
    }
    return false;
  }

  // HALF_OPEN — allow limited probe requests
  return true;
}

/**
 * Records a success for a provider, potentially closing the breaker.
 */
export function recordSuccess(provider: string, config: CircuitBreakerConfig): void {
  const state = getState(provider);

  if (state.state === "HALF_OPEN") {
    state.successes++;
    if (state.successes >= (config.successThreshold ?? 2)) {
      state.state = "CLOSED";
      state.failures = 0;
      state.successes = 0;
    }
    return;
  }

  if (state.state === "CLOSED") {
    state.failures = 0;
  }
}

/**
 * Records a failure for a provider, potentially opening the breaker.
 */
export function recordFailure(provider: string, config: CircuitBreakerConfig): void {
  const state = getState(provider);
  state.failures++;
  state.lastFailureTime = Date.now();

  if (state.state === "HALF_OPEN") {
    state.state = "OPEN";
    return;
  }

  if (state.state === "CLOSED" && state.failures >= config.failureThreshold) {
    state.state = "OPEN";
  }
}

/** Resets all circuit breaker state. Useful for testing. */
export function resetAll(): void {
  circuitMap.clear();
}

/** Returns the current state for a provider (for diagnostics). */
export function getCircuitState(provider: string): ProviderCircuitState | undefined {
  return circuitMap.get(provider);
}
