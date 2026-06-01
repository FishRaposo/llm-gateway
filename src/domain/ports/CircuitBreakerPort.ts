/** Circuit breaker port - interface for provider resilience.
 * Domain defines the contract, infrastructure implements it.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold?: number;
  resetTimeoutMs: number;
}

export interface CircuitBreakerPort {
  isAvailable(provider: string, config: CircuitBreakerConfig): boolean;

  recordSuccess(provider: string, config: CircuitBreakerConfig): void;

  recordFailure(provider: string, config: CircuitBreakerConfig): void;

  getState(provider: string): CircuitState | undefined;

  reset(provider: string): void;

  resetAll(): void;
}
