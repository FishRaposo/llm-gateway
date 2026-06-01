/** Circuit breaker adapter - implements CircuitBreakerPort using existing circuit breaker.
 * Infrastructure layer - wraps external library with domain interface.
 */

import type {
  CircuitBreakerPort,
  CircuitBreakerConfig,
  CircuitState,
} from "../../domain/ports/CircuitBreakerPort";
import {
  isAvailable,
  recordSuccess,
  recordFailure,
  getCircuitState,
  resetProvider,
  resetAll,
} from "../../routing/circuitBreaker";

export class CircuitBreakerAdapter implements CircuitBreakerPort {
  isAvailable(provider: string, config: CircuitBreakerConfig): boolean {
    return isAvailable(provider, config);
  }

  recordSuccess(provider: string, config: CircuitBreakerConfig): void {
    recordSuccess(provider, config);
  }

  recordFailure(provider: string, config: CircuitBreakerConfig): void {
    recordFailure(provider, config);
  }

  getState(provider: string): CircuitState | undefined {
    return getCircuitState(provider)?.state as CircuitState | undefined;
  }

  reset(provider: string): void {
    resetProvider(provider);
  }

  resetAll(): void {
    resetAll();
  }
}
