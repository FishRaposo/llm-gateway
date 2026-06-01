/** Budget tracking middleware for enforcing spending limits. */

import type { GatewayConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { MiddlewareFunction } from "../proxy/handler";
import type { BudgetTracker } from "../storage/budgetTracker";
import { getPricing } from "../shared/pricing";
import { countMessageTokens } from "../shared/tokenCounter";

/**
 * Creates a budget middleware that checks and enforces spending limits per API key.
 * @param config - Gateway configuration.
 * @param budgetTracker - Budget tracking storage backend.
 * @returns Middleware function.
 */
export function createBudgetMiddleware(config: GatewayConfig, budgetTracker: BudgetTracker): MiddlewareFunction {
  return async (
    context: RequestContext,
    _config: GatewayConfig
  ): Promise<RequestContext | null> => {
    if (!config.budgets.enabled) return context;

    const estimatedCost = estimateRequestCost(context);

    const withinGlobalBudget = await budgetTracker.checkGlobalBudget(estimatedCost);
    if (!withinGlobalBudget) {
      const error = new Error(
        `Global budget exceeded. Estimated cost: $${estimatedCost.toFixed(4)}`
      ) as Error & { statusCode: number; code: string };
      error.statusCode = 402;
      error.code = "budget_exceeded";
      throw error;
    }

    const remaining = await budgetTracker.getRemainingBudget(context.apiKey);

    if (remaining < estimatedCost) {
      const error = new Error(
        `Budget exceeded. Remaining: $${remaining.toFixed(4)}, estimated: $${estimatedCost.toFixed(4)}`
      ) as Error & { statusCode: number; code: string };
      error.statusCode = 402;
      error.code = "budget_exceeded";
      throw error;
    }

    return context;
  };
}

/**
 * Checks if an API key has sufficient budget for an estimated cost.
 * @param budgetTracker - Budget tracking storage.
 * @param apiKey - API key to check.
 * @param estimatedCost - Estimated cost of the request.
 * @returns True if the budget allows this request.
 */
export async function checkBudget(
  budgetTracker: BudgetTracker,
  apiKey: string,
  estimatedCost: number
): Promise<boolean> {
  const remaining = await budgetTracker.getRemainingBudget(apiKey);
  return remaining >= estimatedCost;
}

/**
 * Tracks actual spend for an API key after a request completes.
 * @param budgetTracker - Budget tracking storage.
 * @param apiKey - API key that made the request.
 * @param actualCost - Actual cost of the completed request.
 */
export async function trackSpend(
  budgetTracker: BudgetTracker,
  apiKey: string,
  actualCost: number
): Promise<void> {
  await budgetTracker.deductBudget(apiKey, actualCost);
}

/**
 * Estimates the cost of a request using model-specific pricing.
 * Uses characters / 4 as a token estimate, then multiplies by the
 * selected model's input token price.
 * @param context - Request context.
 * @returns Estimated cost in USD.
 */
function estimateRequestCost(context: RequestContext): number {
  const estimatedTokens = countMessageTokens(context.messages);
  const pricing = getPricing(context.originalModel);
  const inputPrice = pricing?.inputPerToken ?? 0.00001;
  return estimatedTokens * inputPrice;
}
