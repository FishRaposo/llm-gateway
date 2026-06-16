import { describe, it, expect } from "vitest";
import {
  MODEL_PRICING_PER_1M,
  getPricing,
  getPricingPer1M,
  getModelInfo,
  listModels,
  calculateCost,
} from "../src/shared/pricing";

/**
 * Golden snapshot of `shared_core.pricing.MODEL_PRICING`
 * (shared-core/src/shared_core/pricing.py), USD per 1,000,000 tokens.
 *
 * This is pinned here on purpose: it is the cross-language contract. If the
 * Python registry changes, this constant and `MODEL_PRICING_PER_1M` must be
 * updated together — the parity test below fails on any drift for shared keys.
 */
const SHARED_CORE_MODEL_PRICING_PER_1M: Record<string, { inputPer1m: number; outputPer1m: number }> = {
  "gpt-4o": { inputPer1m: 5.0, outputPer1m: 15.0 },
  "gpt-4o-mini": { inputPer1m: 0.15, outputPer1m: 0.6 },
  "gpt-4-turbo": { inputPer1m: 10.0, outputPer1m: 30.0 },
  "gpt-4": { inputPer1m: 30.0, outputPer1m: 60.0 },
  "gpt-3.5-turbo": { inputPer1m: 0.5, outputPer1m: 1.5 },
  o1: { inputPer1m: 15.0, outputPer1m: 60.0 },
  "o1-mini": { inputPer1m: 1.1, outputPer1m: 4.4 },
  "o3-mini": { inputPer1m: 1.1, outputPer1m: 4.4 },
  "claude-3-5-sonnet": { inputPer1m: 3.0, outputPer1m: 15.0 },
  "claude-3-5-haiku": { inputPer1m: 0.8, outputPer1m: 4.0 },
  "claude-3-opus": { inputPer1m: 15.0, outputPer1m: 75.0 },
  "claude-3-haiku": { inputPer1m: 0.25, outputPer1m: 1.25 },
  "text-embedding-3-small": { inputPer1m: 0.02, outputPer1m: 0.0 },
  "text-embedding-3-large": { inputPer1m: 0.13, outputPer1m: 0.0 },
};

describe("Pricing parity with shared_core.pricing", () => {
  it("mirrors shared_core per-1M rates for every directly-shared model key", () => {
    // Keys present in both registries (same id) must match exactly.
    for (const [model, shared] of Object.entries(SHARED_CORE_MODEL_PRICING_PER_1M)) {
      const local = MODEL_PRICING_PER_1M[model];
      if (!local) continue; // gateway does not route every shared model
      expect(local.inputPer1m, `${model} input_per_1m`).toBe(shared.inputPer1m);
      expect(local.outputPer1m, `${model} output_per_1m`).toBe(shared.outputPer1m);
    }
  });

  it("matches shared_core claude-3-5-sonnet rates for the dated sonnet id", () => {
    // The gateway routes the dated id; it must price the same as shared_core's
    // canonical `claude-3-5-sonnet`.
    const sonnet = getPricingPer1M("claude-sonnet-4-20250514");
    const shared = SHARED_CORE_MODEL_PRICING_PER_1M["claude-3-5-sonnet"];
    expect(sonnet).not.toBeNull();
    expect(sonnet!.inputPer1m).toBe(shared.inputPer1m);
    expect(sonnet!.outputPer1m).toBe(shared.outputPer1m);
  });

  it("documents the intentional claude-3-5-haiku divergence", () => {
    // Gateway uses 1.0/5.0 for the dated haiku id; shared_core lists 0.8/4.0.
    // This is a known, documented divergence (see docs/roadmap.md). Pinning it
    // here makes any future drift visible rather than silent.
    const haiku = getPricingPer1M("claude-3-5-haiku-20241022");
    expect(haiku).toEqual({ inputPer1m: 1.0, outputPer1m: 5.0 });
    expect(haiku!.inputPer1m).not.toBe(
      SHARED_CORE_MODEL_PRICING_PER_1M["claude-3-5-haiku"].inputPer1m
    );
  });

  it("derives per-token rates from the per-1M registry consistently", () => {
    for (const model of Object.keys(MODEL_PRICING_PER_1M)) {
      const per1m = getPricingPer1M(model)!;
      const perToken = getPricing(model)!;
      expect(perToken.inputPerToken).toBeCloseTo(per1m.inputPer1m / 1_000_000, 15);
      expect(perToken.outputPerToken).toBeCloseTo(per1m.outputPer1m / 1_000_000, 15);
    }
  });
});

describe("Pricing — calculateCost (matches shared_core.calculate_cost formula)", () => {
  it("computes cost as prompt*input + completion*output per token", () => {
    // shared_core: (prompt/1e6)*input_per_1m + (completion/1e6)*output_per_1m.
    // gpt-4o: 5/15 per 1M. 1000 prompt + 500 completion.
    const cost = calculateCost("gpt-4o", 1000, 500);
    const expected = (1000 / 1_000_000) * 5.0 + (500 / 1_000_000) * 15.0;
    expect(cost).toBeCloseTo(expected, 15);
  });

  it("returns 0 for a free (ollama) model", () => {
    expect(calculateCost("ollama-default", 10000, 10000)).toBe(0);
  });

  it("returns 0 for an unknown model rather than throwing", () => {
    expect(calculateCost("does-not-exist", 100, 100)).toBe(0);
  });

  it("scales linearly with token counts", () => {
    const small = calculateCost("gpt-4o-mini", 100, 50);
    const large = calculateCost("gpt-4o-mini", 1000, 500);
    expect(large).toBeCloseTo(small * 10, 12);
  });
});

describe("Pricing — catalog accessors", () => {
  it("getModelInfo returns full metadata for a known model", () => {
    const info = getModelInfo("gpt-4o");
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("openai");
    expect(info!.contextWindow).toBeGreaterThan(0);
    expect(info!.capabilities).toContain("chat");
    expect(info!.pricing.inputPerToken).toBe(5.0 / 1_000_000);
  });

  it("getModelInfo returns null for an unknown model", () => {
    expect(getModelInfo("not-a-real-model")).toBeNull();
  });

  it("getPricing returns null for an unknown model", () => {
    expect(getPricing("not-a-real-model")).toBeNull();
  });

  it("getPricingPer1M returns null for an unknown model", () => {
    expect(getPricingPer1M("not-a-real-model")).toBeNull();
  });

  it("listModels returns every catalog entry with a provider and pricing", () => {
    const models = listModels();
    expect(models.length).toBe(Object.keys(MODEL_PRICING_PER_1M).length);
    for (const m of models) {
      expect(m.provider).toBeTruthy();
      expect(m.pricing).toBeDefined();
      expect(typeof m.pricing.inputPerToken).toBe("number");
    }
  });

  it("every catalog model has a matching per-1M entry and vice versa", () => {
    const catalogNames = listModels()
      .map((m) => m.name)
      .sort();
    const per1mNames = Object.keys(MODEL_PRICING_PER_1M).sort();
    expect(catalogNames).toEqual(per1mNames);
  });
});
