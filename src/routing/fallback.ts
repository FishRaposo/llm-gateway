/** Fallback handler for provider failures with circuit breaker logic. */

import type { GatewayConfig } from "../types";
import type { RequestContext, RoutingDecision } from "../types/routing";
import type { ProviderResponse, ProviderError } from "../types/provider";
import { getProvider } from "../providers/registry";
import { buildProviderRequest } from "../proxy/request";

const circuitBreakerState = new Map<string, { failures: number; lastFailureTime: number; open: boolean }>();

/**
 * Handles a provider failure by trying the next provider in the fallback chain.
 * @param context - The current request context.
 * @param error - The error from the failed provider.
 * @param originalDecision - The original routing decision.
 * @param config - Gateway configuration.
 * @returns Response from a fallback provider.
 * @throws Error if all fallback providers fail.
 */
export async function handleFallback(
  context: RequestContext,
  error: Error,
  originalDecision: RoutingDecision,
  config: GatewayConfig
): Promise<ProviderResponse> {
  const fallbackConfig = config.routing.fallback;
  if (!fallbackConfig.enabled) {
    throw error;
  }

  const providerError = error as unknown as ProviderError;
  if (providerError && !providerError.retryable) {
    throw error;
  }

  updateCircuitBreaker(originalDecision.selectedProvider, true);

  const alternatives = [...originalDecision.alternatives];
  let lastError: Error = error;
  let retries = 0;

  for (const alternative of alternatives) {
    if (retries >= fallbackConfig.maxRetries) break;
    if (isCircuitBreakerOpen(alternative.provider, fallbackConfig.circuitBreaker)) continue;

    try {
      const provider = getProvider(alternative.provider, config);
      const tempDecision: RoutingDecision = {
        selectedProvider: alternative.provider,
        selectedModel: alternative.model,
        fallbackUsed: true,
        ruleMatched: "fallback",
        alternatives: [],
      };
      const request = buildProviderRequest(context, tempDecision);

      const response = await provider.complete(request);
      updateCircuitBreaker(alternative.provider, false);

      return { ...response, provider: alternative.provider };
    } catch (fallbackError) {
      lastError = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
      updateCircuitBreaker(alternative.provider, true);
      retries++;
    }
  }

  throw new Error(`All fallback providers failed. Last error: ${lastError.message}`);
}

/**
 * Updates the circuit breaker state for a provider.
 * @param providerName - Name of the provider.
 * @param failed - Whether the last request failed.
 */
function updateCircuitBreaker(providerName: string, failed: boolean): void {
  const state = circuitBreakerState.get(providerName) ?? { failures: 0, lastFailureTime: 0, open: false };

  if (failed) {
    state.failures++;
    state.lastFailureTime = Date.now();
  } else {
    state.failures = 0;
    state.open = false;
  }

  circuitBreakerState.set(providerName, state);
}

/**
 * Checks if the circuit breaker is open for a provider.
 * Uses the open flag as the authoritative source of truth.
 * @param providerName - Name of the provider.
 * @param config - Circuit breaker configuration.
 * @returns True if the circuit breaker is open (provider should be skipped).
 */
function isCircuitBreakerOpen(
  providerName: string,
  config: { failureThreshold: number; resetTimeoutMs: number }
): boolean {
  const state = circuitBreakerState.get(providerName);
  if (!state) return false;

  if (state.open) {
    if (Date.now() - state.lastFailureTime > config.resetTimeoutMs) {
      state.failures = 0;
      state.open = false;
      return false;
    }
    return true;
  }

  if (state.failures >= config.failureThreshold) {
    state.open = true;
    return true;
  }

  return false;
}

/**
 * Resets the circuit breaker state for all providers. Useful for testing.
 */
export function resetCircuitBreakers(): void {
  circuitBreakerState.clear();
}
