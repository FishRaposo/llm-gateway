/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import { resetCircuitBreakers } from "../src/routing/fallback";
import { resetAll, getCircuitState } from "../src/routing/circuitBreaker";
import { clearProviderRegistry } from "../src/providers/registry";

describe("Fallback Handler", () => {
  beforeEach(() => {
    resetCircuitBreakers();
    resetAll();
    clearProviderRegistry();
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

  it("should record failure on the original provider when fallback triggers", async () => {
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
      selectedProvider: "openai",
      selectedModel: "gpt-4o",
      fallbackUsed: false,
      ruleMatched: "default",
      alternatives: [],
    };
    const config = {
      routing: {
        default: { provider: "openai", model: "gpt-4o" },
        rules: [],
        fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 100 } },
      },
      providers: {},
    } as any;

    const retryableError = Object.assign(new Error("primary failed"), { retryable: true });
    try {
      await handleFallback(context, retryableError, decision, config);
    } catch {
      // expected — no alternatives configured
    }

    const state = getCircuitState("openai");
    expect(state?.failures).toBeGreaterThanOrEqual(1);
  });

  it("should throw 503-like error when all alternatives fail", async () => {
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
      selectedProvider: "openai",
      selectedModel: "gpt-4o",
      fallbackUsed: false,
      ruleMatched: "default",
      alternatives: [
        { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      ],
    };
    const config = {
      routing: {
        default: { provider: "openai", model: "gpt-4o" },
        rules: [],
        fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
      },
      providers: {},
    } as any;

    const retryableError = Object.assign(new Error("primary failed"), { retryable: true });
    await expect(
      handleFallback(context, retryableError, decision, config)
    ).rejects.toThrow("All fallback providers failed");
  });

  it("should fail over to the next provider when a Gemini/Ollama-style error has no retryable flag", async () => {
    // Regression for the fallback bug: Gemini/Ollama previously threw errors
    // whose `retryable` field was undefined, so handleFallback short-circuited
    // and never tried an alternative. A Gemini primary that cannot reach its
    // (unroutable) endpoint must now fail over to the mock alternative.
    const { handleFallback } = await import("../src/routing/fallback");
    const context = {
      requestId: "test",
      apiKey: "key",
      apiKeyName: "test",
      originalModel: "gemini-1.5-pro",
      messages: [{ role: "user" as const, content: "hi" }],
      stream: false,
      metadata: {},
      timestamp: new Date().toISOString(),
    };
    const decision = {
      selectedProvider: "gemini",
      selectedModel: "gemini-1.5-pro",
      fallbackUsed: false,
      ruleMatched: "default",
      alternatives: [{ provider: "mock", model: "mock-model", priority: 1 }],
    };
    const config = {
      routing: {
        default: { provider: "gemini", model: "gemini-1.5-pro" },
        rules: [],
        fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
      },
      providers: {
        gemini: { type: "gemini", apiKey: "x", baseUrl: "http://127.0.0.1:0" },
        mock: { type: "mock", apiKey: "x" },
      },
    } as any;

    // The original Gemini call rejects with a plain network error (no
    // retryable field). Fallback should still kick in and the mock provider
    // should answer.
    const geminiError = new Error("Gemini network failure");
    const response = await handleFallback(context, geminiError, decision, config);
    expect(response.provider).toBe("mock");
    expect(response.choices[0].message.content).toContain("mock");
  });

  it("should skip fallback for non-retryable errors", async () => {
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
      selectedProvider: "openai",
      selectedModel: "gpt-4o",
      fallbackUsed: false,
      ruleMatched: "default",
      alternatives: [],
    };
    const config = {
      routing: {
        default: { provider: "openai", model: "gpt-4o" },
        rules: [],
        fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
      },
      providers: {},
    } as any;

    const nonRetryableError = Object.assign(new Error("auth failed"), { retryable: false });
    await expect(
      handleFallback(context, nonRetryableError, decision, config)
    ).rejects.toThrow("auth failed");
  });
});
