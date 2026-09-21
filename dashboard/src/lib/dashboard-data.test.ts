import { describe, it, expect } from "vitest";
import {
  type AuditLog,
  totalCost,
  averageLatency,
  blockedCount,
  summarize,
  normalizeHealth,
  latencyPolyline,
  budgetUsedPct,
  createSimulatedLog,
  applyBudgetSimulation,
  applyHealthSimulation,
  DEMO_LOGS,
  DEMO_BUDGETS,
  DEMO_HEALTH,
} from "./dashboard-data";

const log = (over: Partial<AuditLog>): AuditLog => ({
  id: "x",
  timestamp: "t",
  model: "gpt-4o",
  provider: "openai",
  costUsd: 0,
  latencyMs: 0,
  status: "success",
  fallbackUsed: false,
  ...over,
});

describe("dashboard-data summary helpers", () => {
  it("totalCost sums costUsd and tolerates missing values", () => {
    const logs = [log({ costUsd: 0.01 }), log({ costUsd: 0.02 }), log({ costUsd: NaN as unknown as number })];
    // NaN || 0 -> treated as 0 via the `|| 0` guard? NaN is falsy-ish: NaN || 0 === 0
    expect(totalCost([log({ costUsd: 0.01 }), log({ costUsd: 0.02 })])).toBeCloseTo(0.03, 10);
    expect(totalCost(logs)).toBeCloseTo(0.03, 10);
  });

  it("averageLatency returns the rounded mean, 0 for empty", () => {
    expect(averageLatency([])).toBe(0);
    expect(averageLatency([log({ latencyMs: 100 }), log({ latencyMs: 201 })])).toBe(151);
  });

  it("blockedCount counts policy_denied and budget_exceeded", () => {
    const logs = [
      log({ status: "success" }),
      log({ status: "policy_denied" }),
      log({ status: "budget_exceeded" }),
      log({ status: "error" }),
    ];
    expect(blockedCount(logs)).toBe(2);
  });

  it("summarize bundles all metrics", () => {
    const logs = [log({ costUsd: 0.5, latencyMs: 100 }), log({ costUsd: 0.5, latencyMs: 300, status: "policy_denied" })];
    expect(summarize(logs)).toEqual({
      totalCost: 1,
      avgLatency: 200,
      blockedCount: 1,
      requestCount: 2,
    });
  });
});

describe("normalizeHealth", () => {
  it("returns [] for undefined input", () => {
    expect(normalizeHealth(undefined)).toEqual([]);
  });

  it("maps a keyed map into an array with defaults", () => {
    const result = normalizeHealth({ openai: { status: "healthy", latencyMs: 50 } });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("openai");
    expect(result[0].status).toBe("healthy");
    expect(result[0].latencyMs).toBe(50);
    expect(result[0].errorRate).toBe(0);
    expect(typeof result[0].lastCheck).toBe("string");
  });

  it("defaults missing status to 'unknown'", () => {
    const result = normalizeHealth({ x: {} });
    expect(result[0].status).toBe("unknown");
  });
});

describe("latencyPolyline", () => {
  it("returns default max and empty points for no logs", () => {
    const { points, maxLatency } = latencyPolyline([], 500, 80);
    expect(points).toBe("");
    expect(maxLatency).toBe(1000);
  });

  it("computes a points string and a max >= 500 floor", () => {
    const logs = [log({ latencyMs: 100 }), log({ latencyMs: 200 })];
    const { points, maxLatency } = latencyPolyline(logs, 500, 80);
    expect(maxLatency).toBe(500);
    expect(points.split(" ")).toHaveLength(2);
    expect(points).toMatch(/^\d/);
  });

  it("caps the timeline at 15 points", () => {
    const logs = Array.from({ length: 30 }, (_, i) => log({ id: String(i), latencyMs: i * 10 }));
    const { points } = latencyPolyline(logs, 500, 80);
    expect(points.split(" ")).toHaveLength(15);
  });
});

describe("budgetUsedPct", () => {
  it("computes the consumed percentage", () => {
    expect(budgetUsedPct({ key: "k", name: "n", limitUsd: 100, usedUsd: 25, remainingUsd: 75, period: "monthly" })).toBe(25);
  });

  it("clamps to 100 when over budget", () => {
    expect(budgetUsedPct({ key: "k", name: "n", limitUsd: 100, usedUsd: 250, remainingUsd: 0, period: "monthly" })).toBe(100);
  });

  it("returns 0 for a zero/invalid limit (no divide-by-zero)", () => {
    expect(budgetUsedPct({ key: "k", name: "n", limitUsd: 0, usedUsd: 10, remainingUsd: 0, period: "monthly" })).toBe(0);
  });
});

describe("demo fixtures", () => {
  it("provide non-empty, well-formed sample data", () => {
    expect(DEMO_LOGS.length).toBeGreaterThan(0);
    expect(DEMO_BUDGETS.length).toBeGreaterThan(0);
    expect(Object.keys(DEMO_HEALTH).length).toBeGreaterThan(0);
    // Demo logs include at least one blocked entry so the violations card is non-zero.
    expect(blockedCount(DEMO_LOGS)).toBeGreaterThan(0);
  });
});

describe("simulation helpers", () => {
  it("createSimulatedLog builds distinct rows per scenario", () => {
    const fallback = createSimulatedLog("provider_fallback", 0);
    const budget = createSimulatedLog("budget_exceeded", 1);
    const guardrail = createSimulatedLog("guardrail_blocked", 2);

    expect(fallback.status).toBe("success");
    expect(fallback.fallbackUsed).toBe(true);
    expect(budget.status).toBe("budget_exceeded");
    expect(guardrail.status).toBe("policy_denied");
  });

  it("applyBudgetSimulation charges production on fallback and caps on budget exceeded", () => {
    const log = createSimulatedLog("provider_fallback", 0);
    const afterFallback = applyBudgetSimulation(DEMO_BUDGETS, "provider_fallback", log);
    const prodAfterFallback = afterFallback.find((b) => b.key === "team-prod");
    expect(prodAfterFallback!.usedUsd).toBeGreaterThan(DEMO_BUDGETS[1].usedUsd);

    const afterExceeded = applyBudgetSimulation(DEMO_BUDGETS, "budget_exceeded", log);
    const prodAfterExceeded = afterExceeded.find((b) => b.key === "team-prod");
    expect(prodAfterExceeded!.usedUsd).toBe(prodAfterExceeded!.limitUsd);
    expect(prodAfterExceeded!.remainingUsd).toBe(0);
  });

  it("applyHealthSimulation degrades openai on provider fallback", () => {
    const updated = applyHealthSimulation(DEMO_HEALTH, "provider_fallback");
    expect(updated.openai.status).toBe("degraded");
    expect(updated.openai.errorRate).toBeGreaterThan(DEMO_HEALTH.openai.errorRate);
    expect(applyHealthSimulation(DEMO_HEALTH, "guardrail_blocked")).toEqual(DEMO_HEALTH);
  });
});
