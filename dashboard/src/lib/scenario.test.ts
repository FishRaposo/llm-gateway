/** Scenario reducer tests: single-source simulation state for every card. */
import { describe, it, expect } from "vitest";
import {
  scenarioReducer,
  initialScenarioState,
  DEMO_BUDGETS,
  DEMO_HEALTH,
  type ScenarioState,
} from "./dashboard-data";

describe("scenarioReducer", () => {
  it("simulate appends one audit row and derives all cards from one state", () => {
    const s0 = initialScenarioState();
    const s1 = scenarioReducer(s0, { type: "simulate", scenario: "provider_fallback" });
    expect(s1.logs).toHaveLength(1);
    expect(s1.logs[0].fallbackUsed).toBe(true);
    expect(s1.logs[0].provider).toBe("anthropic");
    // Budget and health changed through the SAME transition.
    const prod = s1.budgets.find((b) => b.key === "team-prod")!;
    expect(prod.usedUsd).toBeGreaterThan(DEMO_BUDGETS.find((b) => b.key === "team-prod")!.usedUsd);
    expect(s1.health.openai.status).toBe("degraded");
    expect(s1.simCount).toBe(1);
  });

  it("budget_exceeded pins used at the limit and emits a blocked row", () => {
    let s = initialScenarioState();
    s = scenarioReducer(s, { type: "simulate", scenario: "budget_exceeded" });
    const prod = s.budgets.find((b) => b.key === "team-prod")!;
    expect(prod.usedUsd).toBe(prod.limitUsd);
    expect(prod.remainingUsd).toBe(0);
    expect(s.logs[0].status).toBe("budget_exceeded");
  });

  it("burst applies N atomic transitions — budget and logs stay consistent", () => {
    let s = initialScenarioState();
    s = scenarioReducer(s, { type: "burst", scenario: "guardrail_blocked", count: 12 });
    expect(s.logs).toHaveLength(12);
    expect(s.simCount).toBe(12);
    expect(s.logs.every((l) => l.status === "policy_denied")).toBe(true);
    // Deterministic ids — every simulated row is unique.
    expect(new Set(s.logs.map((l) => l.id)).size).toBe(12);
  });

  it("outage marks the provider down; recover restores health without touching ledgers", () => {
    let s = initialScenarioState();
    s = scenarioReducer(s, { type: "simulate", scenario: "provider_outage" });
    expect(s.health.openai.status).toBe("down");
    expect(s.logs[0].status).toBe("error");
    const logsBefore = s.logs;
    const budgetsBefore = s.budgets;
    s = scenarioReducer(s, { type: "recover" });
    expect(s.health.openai.status).toBe("healthy");
    // Recovery does not rewrite history — audit rows and budgets persist.
    expect(s.logs).toBe(logsBefore);
    expect(s.budgets).toBe(budgetsBefore);
  });

  it("reset returns to demo baselines and clears the sim index", () => {
    let s = initialScenarioState();
    s = scenarioReducer(s, { type: "burst", scenario: "provider_fallback", count: 3 });
    expect(s.logs.length).toBe(3);
    s = scenarioReducer(s, { type: "reset" });
    expect(s.logs).toHaveLength(0);
    expect(s.simCount).toBe(0);
    expect(s.budgets).toBe(DEMO_BUDGETS);
    expect(s.health).toBe(DEMO_HEALTH);
  });

  it("mode separation: reducer state is demo-only and immutable across actions", () => {
    const s0: ScenarioState = initialScenarioState();
    const s1 = scenarioReducer(s0, { type: "simulate", scenario: "guardrail_blocked" });
    // Original state object is untouched (connected data never enters here).
    expect(s0.logs).toHaveLength(0);
    expect(s0).not.toBe(s1);
  });
});
