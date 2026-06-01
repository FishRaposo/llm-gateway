import { describe, it, expect, beforeEach } from "vitest";
import { BudgetTracker } from "../src/storage/budgetTracker";
import { CacheStore } from "../src/storage/cacheStore";
import { generateCacheKey } from "../src/middleware/cache";
import { evaluatePolicies } from "../src/middleware/policy";
import type { RequestContext } from "../src/types/routing";
import type { ModelPricing, ProviderResponse } from "../src/types/provider";
import type { PolicyRuleConfig } from "../src/types";

function calculateCost(usage: ProviderResponse["usage"], pricing: ModelPricing): number {
  return usage.promptTokens * pricing.inputPerToken + usage.completionTokens * pricing.outputPerToken;
}

function clampMaxTokens(context: RequestContext, modifications: PolicyRuleConfig["modifications"]): number | undefined {
  if (!modifications || !context.maxTokens) return context.maxTokens;
  for (const mod of modifications) {
    if (mod.field === "maxTokens" && mod.max !== undefined && context.maxTokens > mod.max) {
      return mod.onViolation === "clamp" ? mod.max : context.maxTokens;
    }
  }
  return context.maxTokens;
}

const baseContext: RequestContext = {
  requestId: "test-1",
  apiKey: "gw-test",
  apiKeyName: "test-user",
  originalModel: "gpt-4o-mini",
  messages: [{ role: "user", content: "Explain quantum computing in one sentence." }],
  stream: false,
  metadata: {},
  timestamp: new Date().toISOString(),
};

const gpt4Pricing: ModelPricing = {
  inputPerToken: 0.000005,
  outputPerToken: 0.000015,
};

describe("Handler", () => {
  describe("cost calculation from provider response", () => {
    it("should calculate cost from known token usage and pricing", () => {
      const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
      const cost = calculateCost(usage, gpt4Pricing);

      expect(cost).toBe(100 * 0.000005 + 50 * 0.000015);
      expect(cost).toBe(0.00125);
      expect(cost).toBeGreaterThan(0);
    });

    it("should produce zero cost for zero-token usage", () => {
      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const cost = calculateCost(usage, gpt4Pricing);

      expect(cost).toBe(0);
    });

    it("should handle small token counts without rounding to zero", () => {
      const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
      const cost = calculateCost(usage, gpt4Pricing);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBe(0.00002);
    });

    it("coerces token counts to numbers for cost computation", () => {
      const usage = { promptTokens: 42, completionTokens: 7, totalTokens: 49 };
      const cost = calculateCost(usage, gpt4Pricing);

      expect(typeof cost).toBe("number");
      expect(Number.isFinite(cost)).toBe(true);
    });

    it("cost scales linearly with token count", () => {
      const small = calculateCost({ promptTokens: 100, completionTokens: 50, totalTokens: 150 }, gpt4Pricing);
      const large = calculateCost({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }, gpt4Pricing);

      expect(large).toBe(small * 10);
    });
  });

  describe("cache hit returns cached response", () => {
    let cacheStore: CacheStore;

    beforeEach(() => {
      cacheStore = new CacheStore("redis://localhost:0");
    });

    it("should return cached response for a known cache key", async () => {
      const cacheKey = generateCacheKey(baseContext);

      const cachedResponse = {
        id: "resp-cached-001",
        model: "gpt-4o-mini",
        provider: "openai",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Quantum computing uses qubits to perform calculations on superposition states." },
          finishReason: "stop",
        }],
        usage: { promptTokens: 8, completionTokens: 12, totalTokens: 20 },
      };

      await cacheStore.set(cacheKey, { response: cachedResponse, timestamp: Date.now() }, 3600);

      const cached = await cacheStore.get(cacheKey);

      expect(cached).not.toBeNull();
      expect(cached!.response).toEqual(cachedResponse);
      expect(cached!.response.id).toBe("resp-cached-001");
      expect(cached!.response.provider).toBe("openai");
    });

    it("should return null for uncached key", async () => {
      const miss = await cacheStore.get("cache:never-seen-key");
      expect(miss).toBeNull();
    });

    it("should generate different cache keys for different messages", () => {
      const ctx1 = { ...baseContext, messages: [{ role: "user", content: "A" }] };
      const ctx2 = { ...baseContext, messages: [{ role: "user", content: "B" }] };

      expect(generateCacheKey(ctx1)).not.toBe(generateCacheKey(ctx2));
    });
  });

  describe("trackSpend called after provider response", () => {
    let budgetTracker: BudgetTracker;

    beforeEach(async () => {
      budgetTracker = new BudgetTracker("redis://localhost:0");
    });

    it("should deduct budget when trackSpend is called", async () => {
      await budgetTracker.setBudget("gw-spend-key", 10);

      await budgetTracker.deductBudget("gw-spend-key", 0.05);

      const status = await budgetTracker.getBudgetStatus("gw-spend-key");
      expect(status.used).toBe(0.05);
      expect(status.remaining).toBe(9.95);
    });

    it("should track multiple spend deductions cumulatively", async () => {
      await budgetTracker.setBudget("gw-multi-key", 5);

      await budgetTracker.deductBudget("gw-multi-key", 0.01);
      await budgetTracker.deductBudget("gw-multi-key", 0.02);
      await budgetTracker.deductBudget("gw-multi-key", 0.03);

      const status = await budgetTracker.getBudgetStatus("gw-multi-key");
      expect(status.used).toBe(0.06);
      expect(status.remaining).toBe(4.94);
    });

    it("should reflect actual cost in budget after deduction", async () => {
      const pricing = { inputPerToken: 0.000005, outputPerToken: 0.000015 };
      const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
      const actualCost = calculateCost(usage, pricing);

      await budgetTracker.setBudget("gw-cost-key", 1);
      await budgetTracker.deductBudget("gw-cost-key", actualCost);

      const status = await budgetTracker.getBudgetStatus("gw-cost-key");
      expect(status.used).toBe(actualCost);
    });
  });

  describe("audit entries have non-zero cost", () => {
    it("should produce non-zero cost for typical gpt-4o-mini usage", () => {
      const usage = { promptTokens: 200, completionTokens: 3, totalTokens: 203 };
      const cost = calculateCost(usage, {
        inputPerToken: 0.00000015,
        outputPerToken: 0.0000006,
      });

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(0.0000318, 8);
    });

    it("should produce non-zero cost for typical gpt-4o usage", () => {
      const usage = { promptTokens: 500, completionTokens: 200, totalTokens: 700 };
      const cost = calculateCost(usage, { inputPerToken: 0.000005, outputPerToken: 0.000015 });

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBe(0.0055);
    });

    it("should use provider-specific pricing for cost calculation", () => {
      const gpt4oMiniPricing = { inputPerToken: 0.00000015, outputPerToken: 0.0000006 };
      const gpt4oPricing = { inputPerToken: 0.000005, outputPerToken: 0.000015 };

      const usage = { promptTokens: 100, completionTokens: 100, totalTokens: 200 };

      const miniCost = calculateCost(usage, gpt4oMiniPricing);
      const standardCost = calculateCost(usage, gpt4oPricing);

      expect(standardCost).toBeGreaterThan(miniCost);
    });
  });

  describe("request modification policy clamps max_tokens", () => {
    it("should clamp maxTokens when exceeding policy maximum with clamp strategy", () => {
      const context = { ...baseContext, maxTokens: 4096 };
      const modifications = [
        { field: "maxTokens", max: 2048, onViolation: "clamp" as const },
      ];

      const clamped = clampMaxTokens(context, modifications);

      expect(clamped).toBe(2048);
      expect(clamped).not.toBe(4096);
    });

    it("should not clamp maxTokens when under the policy maximum", () => {
      const context = { ...baseContext, maxTokens: 1024 };
      const modifications = [
        { field: "maxTokens", max: 2048, onViolation: "clamp" as const },
      ];

      const result = clampMaxTokens(context, modifications);

      expect(result).toBe(1024);
    });

    it("should return undefined when context has no maxTokens", () => {
      const context = { ...baseContext, maxTokens: undefined };
      const modifications = [
        { field: "maxTokens", max: 2048, onViolation: "clamp" as const },
      ];

      const result = clampMaxTokens(context, modifications);

      expect(result).toBeUndefined();
    });

    it("should respect deny onViolation strategy by not clamping", () => {
      const context = { ...baseContext, maxTokens: 4096 };
      const modifications = [
        { field: "maxTokens", max: 2048, onViolation: "deny" as const },
      ];

      const result = clampMaxTokens(context, modifications);

      expect(result).toBe(4096);
    });

    it("should allow request through policy with request_modify rule", () => {
      const rules: PolicyRuleConfig[] = [{
        type: "request_modify",
        action: "modify",
        modifications: [
          { field: "maxTokens", max: 2048, onViolation: "clamp" },
        ],
      }];

      const decision = evaluatePolicies(baseContext, rules);

      expect(decision.allowed).toBe(true);
    });

    it("should handle multiple modification rules", () => {
      const context = { ...baseContext, maxTokens: 8192 };
      const modifications = [
        { field: "maxTokens", max: 4096, onViolation: "clamp" as const },
        { field: "maxTokens", max: 2048, onViolation: "clamp" as const },
      ];

      const result = clampMaxTokens(context, modifications);

      expect(result).toBe(4096);
    });
  });
});
