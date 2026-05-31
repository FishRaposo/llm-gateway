import { describe, it, expect, beforeEach } from "vitest";
import { Router } from "../src/routing/router";
import { evaluateRules } from "../src/routing/rules";
import type { RoutingRule } from "../src/types";
import type { RequestContext, RoutingDecision } from "../src/types/routing";

const baseContext: RequestContext = {
  requestId: "test-1",
  apiKey: "test-key",
  apiKeyName: "test",
  originalModel: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }],
  stream: false,
  metadata: {},
  timestamp: new Date().toISOString(),
};

describe("Router", () => {
  let router: Router;

  beforeEach(() => {
    const config = {
      default: { provider: "openai", model: "gpt-4o-mini" },
      rules: [
        {
          type: "model_preference" as const,
          model: "gpt-4o",
          provider: "openai",
          priority: 10,
        },
        {
          type: "fallback_chain" as const,
          models: ["gpt-4o"],
          chain: [
            { provider: "openai", model: "gpt-4o" },
            { provider: "anthropic", model: "claude-sonnet-4-20250514" },
          ],
          priority: 1,
        },
      ],
      fallback: {
        enabled: true,
        maxRetries: 3,
        circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 },
      },
    };
    router = new Router(config);
  });

  it("should return default routing when no rules match", () => {
    const decision = router.route(baseContext);
    expect(decision.selectedProvider).toBe("openai");
    expect(decision.selectedModel).toBe("gpt-4o-mini");
    expect(decision.ruleMatched).toBe("default");
  });

  it("should match model_preference rule", () => {
    const context = { ...baseContext, originalModel: "gpt-4o" };
    const decision = router.route(context);
    expect(decision.selectedProvider).toBe("openai");
    expect(decision.selectedModel).toBe("gpt-4o");
    expect(decision.ruleMatched).toContain("model_preference");
  });

  it("should sort rules by priority (highest first)", () => {
    const rules: RoutingRule[] = [
      { type: "cost_optimize", priority: 5, provider: "anthropic" },
      { type: "model_preference", priority: 10, model: "gpt-4o", provider: "openai" },
    ];
    const decision = evaluateRules(rules, { ...baseContext, originalModel: "gpt-4o" });
    expect(decision).not.toBeNull();
    expect(decision!.selectedProvider).toBe("openai");
  });

  it("should return null when no rules match", () => {
    const rules: RoutingRule[] = [
      { type: "model_preference", priority: 10, model: "gpt-4o", provider: "openai" },
    ];
    const decision = evaluateRules(rules, baseContext);
    expect(decision).toBeNull();
  });

  it("should build fallback alternatives from chain rules", () => {
    const context = { ...baseContext, originalModel: "gpt-4o" };
    const decision = router.route(context);
    expect(decision.alternatives.length).toBeGreaterThan(0);
  });
});
