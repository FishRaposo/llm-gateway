import type { ModelPricing } from "../types/provider";

const pricingMap: Record<string, ModelPricing> = {
  "gpt-4o": { inputPerToken: 0.000005, outputPerToken: 0.000015 },
  "gpt-4o-mini": { inputPerToken: 0.00000015, outputPerToken: 0.0000006 },
  "gpt-4-turbo": { inputPerToken: 0.00001, outputPerToken: 0.00003 },
  "gpt-3.5-turbo": { inputPerToken: 0.0000005, outputPerToken: 0.0000015 },
  "claude-sonnet-4-20250514": { inputPerToken: 0.000003, outputPerToken: 0.000015 },
  "claude-3-5-haiku-20241022": { inputPerToken: 0.000001, outputPerToken: 0.000005 },
};

export function getPricing(model: string): ModelPricing | null {
  return pricingMap[model] ?? null;
}

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = pricingMap[model];
  if (!pricing) return 0;
  return promptTokens * pricing.inputPerToken + completionTokens * pricing.outputPerToken;
}
