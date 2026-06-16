/**
 * Model pricing catalog and cost calculation.
 *
 * ## Single source of truth: `shared_core.pricing.MODEL_PRICING`
 *
 * The canonical per-model token rates for the whole workspace live in the Python
 * package `shared_core.pricing` (see
 * `shared-core/src/shared_core/pricing.py`), expressed as **USD per 1,000,000
 * tokens**. This TypeScript gateway is a *peer* of that package — it cannot
 * import Python, so it mirrors the relevant rates here as **data parity, not
 * code sharing** (as documented in AGENTS.md).
 *
 * `MODEL_PRICING_PER_1M` below is the mirror of the shared registry: it pins the
 * per-1M rates so a parity test (`tests/pricing.test.ts`) can assert they stay in
 * sync with `shared_core`. The per-token `MODEL_CATALOG` used by the running
 * gateway is *derived* from this table via `perToken()`, so there is exactly one
 * place to edit when the upstream rates change.
 *
 * ### Sync procedure
 * When `shared_core.pricing.MODEL_PRICING` changes, update the matching entry in
 * `MODEL_PRICING_PER_1M` and re-run `npx vitest run tests/pricing.test.ts`. The
 * parity test enumerates the models the two registries share and fails on drift.
 *
 * ### Known intentional divergences (tracked as follow-ups, see docs/roadmap.md)
 * - `claude-3-5-haiku`: shared_core lists 0.80 / 4.00 per 1M. The gateway's dated
 *   id `claude-3-5-haiku-20241022` historically uses 1.00 / 5.00. Changing it
 *   would alter existing cost/budget outputs, so it is left as-is and excluded
 *   from the strict parity assertion; reconciling the two is a roadmap item.
 * - `gemini-*` models are gateway-only (not present in `shared_core`).
 */

import type { ModelPricing, ModelInfo } from "../types/provider";

/**
 * A per-1,000,000-token price entry. Mirrors the shape of
 * `shared_core.pricing.PriceEntry` so the two registries can be compared
 * field-for-field in the parity test.
 */
export interface PriceEntryPer1M {
  inputPer1m: number;
  outputPer1m: number;
}

/**
 * Mirror of `shared_core.pricing.MODEL_PRICING` (USD per 1,000,000 tokens).
 *
 * This is the single source of truth for rates inside this gateway. Entries
 * whose key also exists in `shared_core` MUST match it (the parity test enforces
 * this, with the documented `claude-3-5-haiku` exception). Gateway-only entries
 * (gemini, ollama, the dated claude/haiku ids) extend the table for models this
 * proxy routes to.
 */
export const MODEL_PRICING_PER_1M: Record<string, PriceEntryPer1M> = {
  // --- Shared with shared_core.pricing (keep in sync) ---
  "gpt-4o": { inputPer1m: 5.0, outputPer1m: 15.0 },
  "gpt-4o-mini": { inputPer1m: 0.15, outputPer1m: 0.6 },
  "gpt-4-turbo": { inputPer1m: 10.0, outputPer1m: 30.0 },
  "gpt-3.5-turbo": { inputPer1m: 0.5, outputPer1m: 1.5 },
  // shared_core key `claude-3-5-sonnet` == 3.0 / 15.0; the gateway routes the
  // dated id and matches those rates.
  "claude-sonnet-4-20250514": { inputPer1m: 3.0, outputPer1m: 15.0 },
  // --- Gateway-only / intentionally divergent (see header note) ---
  "claude-3-5-haiku-20241022": { inputPer1m: 1.0, outputPer1m: 5.0 },
  "gemini-1.5-pro": { inputPer1m: 1.25, outputPer1m: 5.0 },
  "gemini-1.5-flash": { inputPer1m: 0.075, outputPer1m: 0.3 },
  "ollama-default": { inputPer1m: 0.0, outputPer1m: 0.0 },
};

/** Convert a per-1M price entry into the gateway's per-token shape. */
function perToken(model: string): ModelPricing {
  const entry = MODEL_PRICING_PER_1M[model];
  return {
    inputPerToken: entry.inputPer1m / 1_000_000,
    outputPerToken: entry.outputPer1m / 1_000_000,
  };
}

const MODEL_CATALOG: Record<string, ModelInfo> = {
  "gpt-4o": {
    name: "gpt-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: perToken("gpt-4o"),
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "gpt-4o-mini": {
    name: "gpt-4o-mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: perToken("gpt-4o-mini"),
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "gpt-4-turbo": {
    name: "gpt-4-turbo",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: perToken("gpt-4-turbo"),
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "gpt-3.5-turbo": {
    name: "gpt-3.5-turbo",
    provider: "openai",
    contextWindow: 16385,
    maxOutputTokens: 4096,
    pricing: perToken("gpt-3.5-turbo"),
    capabilities: ["chat", "streaming", "function_calling"],
  },
  "claude-sonnet-4-20250514": {
    name: "claude-sonnet-4-20250514",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: perToken("claude-sonnet-4-20250514"),
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "claude-3-5-haiku-20241022": {
    name: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: perToken("claude-3-5-haiku-20241022"),
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "gemini-1.5-pro": {
    name: "gemini-1.5-pro",
    provider: "gemini",
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    pricing: perToken("gemini-1.5-pro"),
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "gemini-1.5-flash": {
    name: "gemini-1.5-flash",
    provider: "gemini",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    pricing: perToken("gemini-1.5-flash"),
    capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
  },
  "ollama-default": {
    name: "ollama-default",
    provider: "ollama",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: perToken("ollama-default"),
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
 * Returns the per-1,000,000-token price entry for a model, or null if unknown.
 * Useful for display and for cross-language parity checks against `shared_core`.
 */
export function getPricingPer1M(model: string): PriceEntryPer1M | null {
  return MODEL_PRICING_PER_1M[model] ?? null;
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
