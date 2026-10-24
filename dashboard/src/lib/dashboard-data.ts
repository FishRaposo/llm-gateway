/**
 * Pure data helpers for the dashboard.
 *
 * Everything here is framework-agnostic and side-effect free so it can be unit
 * tested without rendering React. The page component composes these helpers.
 */

export interface AuditLog {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  costUsd: number;
  latencyMs: number;
  status: string;
  fallbackUsed: boolean;
  routingDecision?: string;
}

export interface BudgetInfo {
  key: string;
  name: string;
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  period: string;
}

export interface ProviderHealth {
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs: number;
  errorRate: number;
  lastCheck: string;
}

export interface DashboardSummary {
  totalCost: number;
  avgLatency: number;
  blockedCount: number;
  requestCount: number;
}

/** Sum of cost across the buffered logs. */
export function totalCost(logs: AuditLog[]): number {
  return logs.reduce((sum, d) => sum + (d.costUsd || 0), 0);
}

/** Mean latency (rounded), or 0 when there are no logs. */
export function averageLatency(logs: AuditLog[]): number {
  if (logs.length === 0) return 0;
  return Math.round(logs.reduce((sum, d) => sum + (d.latencyMs || 0), 0) / logs.length);
}

/** Count of requests blocked by policy or budget enforcement. */
export function blockedCount(logs: AuditLog[]): number {
  return logs.filter((g) => g.status === "policy_denied" || g.status === "budget_exceeded").length;
}

/** One-shot summary used by the metric cards. */
export function summarize(logs: AuditLog[]): DashboardSummary {
  return {
    totalCost: totalCost(logs),
    avgLatency: averageLatency(logs),
    blockedCount: blockedCount(logs),
    requestCount: logs.length,
  };
}

/** Normalize the keyed provider-health map from the API into an array. */
export function normalizeHealth(
  providers: Record<string, Partial<ProviderHealth>> | undefined
): ProviderHealth[] {
  if (!providers) return [];
  return Object.entries(providers).map(([name, info]) => ({
    name,
    status: info.status || "unknown",
    latencyMs: info.latencyMs || 0,
    errorRate: info.errorRate || 0,
    lastCheck: info.lastCheck || new Date().toISOString(),
  }));
}

/** Build the SVG polyline points string for the latency sparkline. */
export function latencyPolyline(
  logs: AuditLog[],
  chartWidth: number,
  chartHeight: number
): { points: string; maxLatency: number } {
  const latencyPoints = logs.slice(0, 15).reverse().map((log) => log.latencyMs);
  const maxLatency = latencyPoints.length > 0 ? Math.max(...latencyPoints, 500) : 1000;
  const points = latencyPoints
    .map((lat, idx) => {
      const x = (idx / Math.max(latencyPoints.length - 1, 1)) * chartWidth;
      const y = chartHeight - (lat / maxLatency) * chartHeight * 0.8 - 5;
      return `${x},${y}`;
    })
    .join(" ");
  return { points, maxLatency };
}

/** Percentage of a budget consumed, clamped to [0, 100]. */
export function budgetUsedPct(b: BudgetInfo): number {
  if (b.limitUsd <= 0) return 0;
  return Math.min((b.usedUsd / b.limitUsd) * 100, 100);
}

// --- Demo mode -------------------------------------------------------------

/**
 * Deterministic demo data so the dashboard renders a realistic view with no
 * backend running (e.g. in a static preview or before the gateway is up).
 */
export const DEMO_LOGS: AuditLog[] = [
  { id: "demo-1", timestamp: "2026-06-15T12:00:00Z", model: "gpt-4o", provider: "openai", costUsd: 0.0123, latencyMs: 410, status: "success", fallbackUsed: false, routingDecision: "model_preference" },
  { id: "demo-2", timestamp: "2026-06-15T12:00:05Z", model: "claude-sonnet-4-20250514", provider: "anthropic", costUsd: 0.0089, latencyMs: 620, status: "success", fallbackUsed: true, routingDecision: "fallback_chain" },
  { id: "demo-3", timestamp: "2026-06-15T12:00:10Z", model: "gpt-4o-mini", provider: "openai", costUsd: 0.0004, latencyMs: 180, status: "cached", fallbackUsed: false, routingDecision: "cost_optimize" },
  { id: "demo-4", timestamp: "2026-06-15T12:00:15Z", model: "gemini-1.5-flash", provider: "gemini", costUsd: 0.0002, latencyMs: 240, status: "success", fallbackUsed: false, routingDecision: "latency_optimize" },
  { id: "demo-5", timestamp: "2026-06-15T12:00:20Z", model: "gpt-4o", provider: "openai", costUsd: 0, latencyMs: 95, status: "policy_denied", fallbackUsed: false, routingDecision: "model_preference" },
  { id: "demo-6", timestamp: "2026-06-15T12:00:25Z", model: "claude-3-5-haiku-20241022", provider: "anthropic", costUsd: 0, latencyMs: 130, status: "budget_exceeded", fallbackUsed: false, routingDecision: "cost_optimize" },
];

export const DEMO_BUDGETS: BudgetInfo[] = [
  { key: "team-research", name: "Research Team", limitUsd: 100, usedUsd: 42.5, remainingUsd: 57.5, period: "monthly" },
  { key: "team-prod", name: "Production", limitUsd: 500, usedUsd: 487.2, remainingUsd: 12.8, period: "monthly" },
];

export const DEMO_HEALTH: Record<string, ProviderHealth> = {
  openai: { name: "openai", status: "healthy", latencyMs: 320, errorRate: 0.01, lastCheck: "2026-06-15T12:00:00Z" },
  anthropic: { name: "anthropic", status: "healthy", latencyMs: 410, errorRate: 0.0, lastCheck: "2026-06-15T12:00:00Z" },
  gemini: { name: "gemini", status: "degraded", latencyMs: 980, errorRate: 0.12, lastCheck: "2026-06-15T12:00:00Z" },
};

// --- Interactive demo simulations ------------------------------------------

export type SimulationScenario = "provider_fallback" | "provider_outage" | "budget_exceeded" | "guardrail_blocked";

/** Human-readable labels for the simulate-request panel. */
export const SIMULATION_LABELS: Record<SimulationScenario, string> = {
  provider_fallback: "Provider fallback",
  provider_outage: "Provider outage",
  budget_exceeded: "Budget exceeded",
  guardrail_blocked: "Guardrail blocked",
};

/**
 * Build a new audit-log row for one of the three portfolio demo scenarios.
 * `index` keeps ids deterministic within a session.
 */
export function createSimulatedLog(scenario: SimulationScenario, index: number): AuditLog {
  const id = `sim-${scenario}-${index}`;
  const timestamp = new Date().toISOString();

  switch (scenario) {
    case "provider_fallback":
      return {
        id,
        timestamp,
        model: "gpt-4o",
        provider: "anthropic",
        costUsd: 0.0156,
        latencyMs: 890,
        status: "success",
        fallbackUsed: true,
        routingDecision: "fallback_chain",
      };
    case "budget_exceeded":
      return {
        id,
        timestamp,
        model: "gpt-4o",
        provider: "openai",
        costUsd: 0,
        latencyMs: 45,
        status: "budget_exceeded",
        fallbackUsed: false,
        routingDecision: "cost_optimize",
      };
    case "provider_outage":
      return {
        id,
        timestamp,
        model: "gpt-4o",
        provider: "openai",
        costUsd: 0,
        latencyMs: 30012,
        status: "error",
        fallbackUsed: false,
        routingDecision: "circuit_open",
      };
    case "guardrail_blocked":
      return {
        id,
        timestamp,
        model: "gpt-4o-mini",
        provider: "openai",
        costUsd: 0,
        latencyMs: 38,
        status: "policy_denied",
        fallbackUsed: false,
        routingDecision: "model_preference",
      };
  }
}

/** Apply budget-side effects that match the simulated gateway decision. */
export function applyBudgetSimulation(
  budgets: BudgetInfo[],
  scenario: SimulationScenario,
  log: AuditLog
): BudgetInfo[] {
  if (scenario === "provider_fallback" && log.costUsd > 0) {
    return budgets.map((b) => {
      if (b.key !== "team-prod") return b;
      const usedUsd = b.usedUsd + log.costUsd;
      return {
        ...b,
        usedUsd,
        remainingUsd: Math.max(0, b.limitUsd - usedUsd),
      };
    });
  }

  if (scenario === "budget_exceeded") {
    return budgets.map((b) => {
      if (b.key !== "team-prod") return b;
      return { ...b, usedUsd: b.limitUsd, remainingUsd: 0 };
    });
  }

  return budgets;
}

/** Apply provider-health deltas for scenarios that affect routing. */
export function applyHealthSimulation(
  health: Record<string, ProviderHealth>,
  scenario: SimulationScenario
): Record<string, ProviderHealth> {
  const openai = health.openai;
  if (!openai) return health;

  if (scenario === "provider_outage") {
    return {
      ...health,
      openai: {
        ...openai,
        status: "down",
        errorRate: 1,
        lastCheck: new Date().toISOString(),
      },
    };
  }

  if (scenario !== "provider_fallback") return health;

  return {
    ...health,
    openai: {
      ...openai,
      status: "degraded",
      errorRate: Math.min(openai.errorRate + 0.05, 1),
      latencyMs: openai.latencyMs + 120,
      lastCheck: new Date().toISOString(),
    },
  };
}

// --- Scenario state machine --------------------------------------------------

/**
 * One scenario state owns everything the demo simulation mutates: the audit
 * rows, budget cards, and provider health all derive from this single object.
 * Connected (live API) data never enters the reducer — mode separation is
 * enforced by the caller rendering connected data only when demoMode is off.
 */
export interface ScenarioState {
  logs: AuditLog[];
  budgets: BudgetInfo[];
  health: Record<string, ProviderHealth>;
  /** Number of simulated requests applied — indexes deterministic ids. */
  simCount: number;
}

export type ScenarioAction =
  | { type: "simulate"; scenario: SimulationScenario }
  | { type: "burst"; scenario: SimulationScenario; count: number }
  | { type: "recover" }
  | { type: "reset"; base?: Partial<Pick<ScenarioState, "budgets" | "health">> };

export function initialScenarioState(): ScenarioState {
  return { logs: [], budgets: DEMO_BUDGETS, health: DEMO_HEALTH, simCount: 0 };
}

export function scenarioReducer(state: ScenarioState, action: ScenarioAction): ScenarioState {
  switch (action.type) {
    case "simulate": {
      const log = createSimulatedLog(action.scenario, state.simCount);
      return {
        logs: [log, ...state.logs],
        budgets: applyBudgetSimulation(state.budgets, action.scenario, log),
        health: applyHealthSimulation(state.health, action.scenario),
        simCount: state.simCount + 1,
      };
    }
    case "burst": {
      let next = state;
      const count = Math.max(0, Math.min(action.count, 50));
      for (let i = 0; i < count; i++) {
        next = scenarioReducer(next, { type: "simulate", scenario: action.scenario });
      }
      return next;
    }
    case "recover": {
      const health = Object.fromEntries(
        Object.entries(state.health).map(([name, info]) => [
          name,
          { ...info, status: "healthy" as const, errorRate: 0, lastCheck: new Date().toISOString() },
        ])
      );
      return { ...state, health };
    }
    case "reset":
      return {
        logs: [],
        budgets: action.base?.budgets ?? DEMO_BUDGETS,
        health: action.base?.health ?? DEMO_HEALTH,
        simCount: 0,
      };
  }
}
