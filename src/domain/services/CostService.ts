/** Domain service for cost calculation.
 * Pure business logic with no external dependencies.
 */

import type { TokenUsage } from "../models/Response";

export interface ModelPricing {
  inputPricePerToken: number;
  outputPricePerToken: number;
}

const DEFAULT_PRICING: ModelPricing = {
  inputPricePerToken: 0.00001,
  outputPricePerToken: 0.00003,
};

// Pricing catalog - in real system this would be loaded from config
const PRICING_CATALOG: Record<string, ModelPricing> = {
  "gpt-4o": { inputPricePerToken: 0.000005, outputPricePerToken: 0.000015 },
  "gpt-4o-mini": { inputPricePerToken: 0.00000015, outputPricePerToken: 0.0000006 },
  "gpt-4": { inputPricePerToken: 0.00003, outputPricePerToken: 0.00006 },
  "claude-sonnet-4-20250514": { inputPricePerToken: 0.000003, outputPricePerToken: 0.000015 },
  "claude-haiku-20240307": { inputPricePerToken: 0.00000025, outputPricePerToken: 0.00000125 },
  "gemini-1.5-pro": { inputPricePerToken: 0.00000125, outputPricePerToken: 0.000005 },
  "gemini-1.5-flash": { inputPricePerToken: 0.000000075, outputPricePerToken: 0.0000003 },
};

/** Get pricing for a model */
export function getModelPricing(model: string): ModelPricing {
  // Normalize model name (strip version/date suffixes)
  const normalized = model.toLowerCase().replace(/-\d{8}$/, "");

  for (const [key, pricing] of Object.entries(PRICING_CATALOG)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return pricing;
    }
  }

  return DEFAULT_PRICING;
}

/** Calculate cost for a request based on token usage */
export function calculateCost(
  model: string,
  usage: TokenUsage
): number {
  const pricing = getModelPricing(model);
  const inputCost = usage.promptTokens * pricing.inputPricePerToken;
  const outputCost = usage.completionTokens * pricing.outputPricePerToken;
  return inputCost + outputCost;
}

/** Estimate cost before making a request */
export function estimateRequestCost(
  model: string,
  estimatedTokens: number
): number {
  const pricing = getModelPricing(model);
  return estimatedTokens * pricing.inputPricePerToken;
}
