/** Fallback handler for provider failures with HALF_OPEN circuit breaker. */

import type { GatewayConfig } from "../types";
import type { RequestContext, RoutingDecision } from "../types/routing";
import type { ProviderResponse, ProviderError } from "../types/provider";
import { getProvider } from "../providers/registry";
import { buildProviderRequest } from "../proxy/request";
import { isAvailable, recordSuccess, recordFailure, resetAll } from "./circuitBreaker";

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

  // Only short-circuit when the provider explicitly marks the error as
  // non-retryable. Providers that throw a plain Error (no `retryable` field)
  // leave it `undefined`; treating that as non-retryable would silently
  // disable fallback for Gemini/Ollama/Mock, defeating the reliability
  // feature. A missing flag therefore falls through to the fallback chain.
  const providerError = error as unknown as Partial<ProviderError>;
  if (providerError && providerError.retryable === false) {
    throw error;
  }

  recordFailure(originalDecision.selectedProvider, fallbackConfig.circuitBreaker);

  const alternatives = [...originalDecision.alternatives];
  let lastError: Error = error;
  let retries = 0;

  for (const alternative of alternatives) {
    if (retries >= fallbackConfig.maxRetries) break;
    if (!isAvailable(alternative.provider, fallbackConfig.circuitBreaker)) continue;

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
      recordSuccess(alternative.provider, fallbackConfig.circuitBreaker);

      return { ...response, provider: alternative.provider };
    } catch (fallbackError) {
      lastError = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
      recordFailure(alternative.provider, fallbackConfig.circuitBreaker);
      retries++;
    }
  }

  throw new Error(`All fallback providers failed. Last error: ${lastError.message}`);
}

/**
 * Resets the circuit breaker state for all providers. Useful for testing.
 */
export function resetCircuitBreakers(): void {
  resetAll();
}
