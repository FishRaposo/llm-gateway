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
