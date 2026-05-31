import { describe, it, expect, beforeEach } from "vitest";
import { resetCircuitBreakers } from "../src/routing/fallback";

describe("Fallback Handler", () => {
  beforeEach(() => {
    resetCircuitBreakers();
  });

  it("should be defined and export resetCircuitBreakers", () => {
    expect(resetCircuitBreakers).toBeDefined();
    expect(typeof resetCircuitBreakers).toBe("function");
  });

  it("should export handleFallback function", async () => {
    const { handleFallback } = await import("../src/routing/fallback");
    expect(handleFallback).toBeDefined();
    expect(typeof handleFallback).toBe("function");
  });

  it("should throw when fallback is disabled", async () => {
    const { handleFallback } = await import("../src/routing/fallback");
    const context = {
      requestId: "test",
      apiKey: "key",
      apiKeyName: "test",
      originalModel: "gpt-4o",
      messages: [{ role: "user" as const, content: "hi" }],
      stream: false,
      metadata: {},
      timestamp: new Date().toISOString(),
    };
    const decision = {
      selectedProvider: "mock",
      selectedModel: "gpt-4o",
      fallbackUsed: false,
      ruleMatched: "default",
      alternatives: [],
    };
    const config = {
      routing: {
        default: { provider: "mock", model: "gpt-4o" },
        rules: [],
        fallback: { enabled: false, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
      },
      providers: {},
    } as any;

    await expect(
      handleFallback(context, new Error("test"), decision, config)
    ).rejects.toThrow("test");
  });
});
