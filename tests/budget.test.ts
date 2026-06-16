import { describe, it, expect, beforeEach } from "vitest";
import { BudgetTracker } from "../src/storage/budgetTracker";
import { createBudgetMiddleware } from "../src/middleware/budget";
import { countMessageTokens } from "../src/shared/tokenCounter";
import { getPricing } from "../src/shared/pricing";
import type { GatewayConfig } from "../src/types";
import type { RequestContext } from "../src/types/routing";

describe("Budget Tracker", () => {
  let budgetTracker: BudgetTracker;

  beforeEach(async () => {
    budgetTracker = new BudgetTracker("redis://localhost:0");
  });

  it("should return Infinity when no budget is set", async () => {
    const remaining = await budgetTracker.getRemainingBudget("unknown-key");
    expect(remaining).toBe(Infinity);
  });

  it("should set and track budget limits", async () => {
    await budgetTracker.setBudget("test-key", 100);
    const status = await budgetTracker.getBudgetStatus("test-key");
    expect(status.limit).toBe(100);
    expect(status.used).toBe(0);
    expect(status.remaining).toBe(100);
  });

  it("should deduct from budget", async () => {
    await budgetTracker.setBudget("deduct-key", 50);
    await budgetTracker.deductBudget("deduct-key", 10);
    const status = await budgetTracker.getBudgetStatus("deduct-key");
    expect(status.used).toBe(10);
    expect(status.remaining).toBe(40);
  });

  it("should report remaining budget accurately", async () => {
    await budgetTracker.setBudget("remaining-key", 25);
    await budgetTracker.deductBudget("remaining-key", 20);
    const remaining = await budgetTracker.getRemainingBudget("remaining-key");
    expect(remaining).toBe(5);
  });

  it("should reset budget usage while keeping limit", async () => {
    await budgetTracker.setBudget("reset-key", 100);
    await budgetTracker.deductBudget("reset-key", 75);
    await budgetTracker.resetBudget("reset-key");
    const status = await budgetTracker.getBudgetStatus("reset-key");
    expect(status.used).toBe(0);
    expect(status.limit).toBe(100);
  });

  it("should not go below zero remaining", async () => {
    await budgetTracker.setBudget("zero-key", 10);
    await budgetTracker.deductBudget("zero-key", 15);
    const remaining = await budgetTracker.getRemainingBudget("zero-key");
    expect(remaining).toBe(0);
  });
});

describe("Budget Middleware (per-key enforcement by record id)", () => {
  const model = "gpt-4o";
  const messageText = "hello world, this is a budgeted request that consumes some tokens";

  // Mirror the middleware's own cost estimate so the assertions are exact
  // regardless of tokenizer specifics.
  const estimate =
    countMessageTokens([{ content: messageText }]) *
    (getPricing(model)?.inputPerToken ?? 0.00001);

  function makeConfig(): GatewayConfig {
    return {
      port: 3000,
      logLevel: "info",
      defaultModel: "gpt-4",
      defaultProvider: "openai",
      databasePath: ":memory:",
      redisUrl: "redis://localhost:0",
      gatewayApiKey: "admin-key",
      providers: {},
      routing: {
        default: { provider: "openai", model },
        rules: [],
        fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
      },
      policy: { enabled: false, evalOrder: [], rules: [] },
      budgets: { enabled: true, globalLimitUsd: Infinity, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
    };
  }

  function makeContext(apiKeyId: string): RequestContext {
    return {
      requestId: "req-1",
      apiKey: "gw-plaintext-secret",
      apiKeyName: "tester",
      apiKeyId,
      permissions: ["chat"],
      originalModel: model,
      messages: [{ role: "user", content: messageText }],
      stream: false,
      metadata: {},
      timestamp: new Date().toISOString(),
    };
  }

  it("enforces and deducts by record id: spend reduces remaining and overspend is rejected", async () => {
    const tracker = new BudgetTracker("redis://localhost:0", Infinity);
    const recordId = "key-record-uuid-1";
    // Budget set under the RECORD ID (as admin key creation now does), not the
    // plaintext key. Give the key room for exactly two estimated requests.
    const limit = estimate * 2.5;
    await tracker.setBudget(recordId, limit);

    const config = makeConfig();
    const middleware = createBudgetMiddleware(config, tracker);

    // First request is within budget and passes.
    const result = await middleware(makeContext(recordId), config);
    expect(result).not.toBeNull();

    // Remaining is read by record id and is finite — proving the limit is
    // enforced, not the Infinity no-op the old plaintext-key path returned.
    const before = await tracker.getRemainingBudget(recordId);
    expect(before).toBeCloseTo(limit, 12);

    // Simulate the handler deducting actual spend by the same record id, drawing
    // remaining below the next request's estimated cost.
    await tracker.deductBudget(recordId, estimate * 2);
    const after = await tracker.getRemainingBudget(recordId);
    expect(after).toBeCloseTo(estimate * 0.5, 12);
    expect(after).toBeLessThan(estimate);

    // A further request now exceeds the remaining budget and is rejected (402).
    await expect(middleware(makeContext(recordId), config)).rejects.toMatchObject({
      statusCode: 402,
      code: "budget_exceeded",
    });
  });
});
