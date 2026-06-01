import type { ModelPricing, ModelInfo } from "../types/provider";

const MODEL_CATALOG: Record<string, ModelInfo> = {
  "gpt-4o": {
    name: "gpt-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: { inputPerToken: 0.000005, outputPerToken: 0.000015 },
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "gpt-4o-mini": {
    name: "gpt-4o-mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: { inputPerToken: 0.00000015, outputPerToken: 0.0000006 },
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "gpt-4-turbo": {
    name: "gpt-4-turbo",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: { inputPerToken: 0.00001, outputPerToken: 0.00003 },
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "gpt-3.5-turbo": {
    name: "gpt-3.5-turbo",
    provider: "openai",
    contextWindow: 16385,
    maxOutputTokens: 4096,
    pricing: { inputPerToken: 0.0000005, outputPerToken: 0.0000015 },
    capabilities: ["chat", "streaming", "function_calling"],
  },
  "claude-sonnet-4-20250514": {
    name: "claude-sonnet-4-20250514",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPerToken: 0.000003, outputPerToken: 0.000015 },
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "claude-3-5-haiku-20241022": {
    name: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPerToken: 0.000001, outputPerToken: 0.000005 },
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "gemini-1.5-pro": {
    name: "gemini-1.5-pro",
    provider: "gemini",
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    pricing: { inputPerToken: 0.00000125, outputPerToken: 0.000005 },
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "gemini-1.5-flash": {
    name: "gemini-1.5-flash",
    provider: "gemini",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    pricing: { inputPerToken: 0.000000075, outputPerToken: 0.0000003 },
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "ollama-default": {
    name: "ollama-default",
    provider: "ollama",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: { inputPerToken: 0, outputPerToken: 0 },
    capabilities: ["chat", "streaming"],
  },
};

/**
 * Returns the pricing for a model, or null if unknown.
 */
export function getPricing(model: string): ModelPricing | null {
  return MODEL_CATALOG[model]?.pricing ?? null;
}

/**
 * Returns full model info, or null if unknown.
 */
export function getModelInfo(model: string): ModelInfo | null {
  return MODEL_CATALOG[model] ?? null;
}

/**
 * Lists all models in the catalog.
 */
export function listModels(): ModelInfo[] {
  return Object.values(MODEL_CATALOG);
}

/**
 * Calculates cost in USD from token usage and model pricing.
 */
export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_CATALOG[model]?.pricing;
  if (!pricing) return 0;
  return promptTokens * pricing.inputPerToken + completionTokens * pricing.outputPerToken;
}
