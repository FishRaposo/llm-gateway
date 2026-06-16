import { describe, it, expect, vi, afterEach } from "vitest";
import type { GatewayConfig } from "../src/types";
import type { RequestContext } from "../src/types/routing";

// Mock the guardrails module so we can drive the sanitize path deterministically
// (the default piiAction is "flag", so sanitization is dormant in production).
vi.mock("../src/guardrails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/guardrails")>();
  return {
    ...actual,
    evaluateGuardrails: vi.fn(),
  };
});

import { createPolicyMiddleware } from "../src/middleware/policy";
import * as guardrails from "../src/guardrails";

const config: GatewayConfig = {
  port: 0,
  logLevel: "info",
  defaultModel: "gpt-4o-mini",
  defaultProvider: "openai",
  databasePath: ":memory:",
  redisUrl: "redis://localhost:0",
  gatewayApiKey: "admin-key",
  providers: {},
  routing: {
    default: { provider: "openai", model: "gpt-4o-mini" },
    rules: [],
    fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
  },
  policy: { enabled: false, evalOrder: [], rules: [] },
  budgets: { enabled: false, globalLimitUsd: 1000, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
};

function makeContext(): RequestContext {
  return {
    requestId: "req",
    apiKey: "key",
    apiKeyName: "tester",
    permissions: ["chat"],
    originalModel: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "My email is alice@test.com" },
    ],
    stream: false,
    metadata: {},
    timestamp: new Date().toISOString(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Policy middleware — per-message sanitization", () => {
  it("sanitizes each message independently instead of clobbering all with one blob", async () => {
    const mocked = guardrails.evaluateGuardrails as unknown as ReturnType<typeof vi.fn>;

    // 1st call: the combined-content pass that decides allow + whether anything
    // was sanitized at all. It returns a joined sanitized blob.
    mocked
      .mockReturnValueOnce({
        allowed: true,
        checks: [],
        sanitized: "You are a helpful assistant. My email is [EMAIL]",
      })
      // 2nd call: per-message pass for the system message (no PII -> unchanged).
      .mockReturnValueOnce({ allowed: true, checks: [] })
      // 3rd call: per-message pass for the user message (PII -> sanitized).
      .mockReturnValueOnce({
        allowed: true,
        checks: [],
        sanitized: "My email is [EMAIL]",
      });

    const middleware = createPolicyMiddleware(config);
    const ctx = makeContext();
    const result = await middleware(ctx, config);

    expect(result).not.toBeNull();
    // The system message must remain untouched (NOT overwritten by the blob).
    expect(ctx.messages[0].content).toBe("You are a helpful assistant.");
    // The user message gets only its own sanitized content.
    expect(ctx.messages[1].content).toBe("My email is [EMAIL]");
    // Neither message should contain the joined blob from the combined pass.
    expect(ctx.messages[0].content).not.toContain("My email is");
  });
});
