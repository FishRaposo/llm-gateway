"use client";

import { useReducer, useState } from "react";
import useSWR from "swr";
import {
  type AuditLog,
  type BudgetInfo,
  type ProviderHealth,
  type SimulationScenario,
  type ScenarioAction,
  summarize,
  normalizeHealth,
  latencyPolyline,
  budgetUsedPct,
  scenarioReducer,
  initialScenarioState,
  SIMULATION_LABELS,
  DEMO_LOGS,
  DEMO_BUDGETS,
  DEMO_HEALTH,
} from "../lib/dashboard-data";

const API_BASE = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_GATEWAY_API_KEY || "gateway-admin-key";

/** Force demo mode regardless of backend availability (useful for static previews). */
function isForceDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// State-driven Interactive Hover Card
function HoverCard({
  title,
  value,
  subtitle,
  accentColor = "#0f5f57",
  glowColor = "rgba(15, 95, 87, 0.15)",
}: {
  title: string;
  value: string;
  subtitle?: string;
  accentColor?: string;
  glowColor?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? "#ffffff"
          : "#fffdf8",
        border: hovered ? `1px solid ${accentColor}` : "1px solid rgba(19, 37, 31, 0.16)",
        borderRadius: 16,
        padding: "24px 20px",
        minWidth: 200,
        boxShadow: hovered
          ? `0 12px 30px 0 ${glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`
          : "0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(19, 37, 31, 0.12)",
        backdropFilter: "none",
        transform: "none",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "default",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top glowing line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accentColor,
          opacity: hovered ? 1 : 0.4,
          transition: "opacity 0.3s ease",
        }}
      />
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.5, color: "#4d6156", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: hovered ? "#13251f" : accentColor, textShadow: hovered ? `0 0 15px ${accentColor}` : "none", transition: "all 0.3s ease" }}>
        {value}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: "#5b6f63", marginTop: 6, fontWeight: 500 }}>{subtitle}</div>}
    </div>
  );
}

function DemoBanner({ forceDemo }: { forceDemo: boolean }) {
  const message = forceDemo
    ? "Sample data — deterministic gateway fixtures."
    : `Gateway unreachable — showing sample data.`;

  return (
    <div
      data-testid="demo-banner"
      data-force-demo={forceDemo ? "true" : "false"}
      style={{
        background: "rgba(138, 90, 18, 0.1)",
        border: "1px solid rgba(138, 90, 18, 0.3)",
        borderRadius: 12,
        padding: "12px 18px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "#8a5a12",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span style={{ width: 8, height: 8, background: "#8a5a12", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px #8a5a12" }} />
      {message}
    </div>
  );
}

const SIMULATION_SCENARIOS: SimulationScenario[] = [
  "provider_fallback",
  "provider_outage",
  "budget_exceeded",
  "guardrail_blocked",
];

function SimulateRequestPanel({ dispatch }: { dispatch: (action: ScenarioAction) => void }) {
  return (
    <section
      data-testid="simulate-request-panel"
      style={{
        background: "#fffdf8",
        border: "1px solid rgba(19, 37, 31, 0.16)",
        borderRadius: 16,
        padding: 24,
        marginBottom: 40,
        boxShadow: "0 8px 24px rgba(19,37,31,0.08)",
        backdropFilter: "none",
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>Simulate request</h2>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "#5b6f63" }}>
        Push a sample decision through the proxy control point — audit log, budgets, and provider health update together.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {SIMULATION_SCENARIOS.map((scenario) => (
          <button
            key={scenario}
            type="button"
            data-testid={`simulate-${scenario}`}
            onClick={() => dispatch({ type: "simulate", scenario })}
            style={{
              background: "rgba(15, 95, 87, 0.1)",
              border: "1px solid rgba(15, 95, 87, 0.25)",
              borderRadius: 10,
              padding: "10px 16px",
              color: "#0f5f57",
              fontSize: 13,
              fontWeight: 700,
              cursor: "default",
              transition: "all 0.2s ease",
            }}
          >
            {SIMULATION_LABELS[scenario]}
          </button>
        ))}
        <button
          type="button"
          data-testid="simulate-recover"
          onClick={() => dispatch({ type: "recover" })}
          style={{
            background: "rgba(34, 197, 94, 0.1)",
            border: "1px solid rgba(34, 197, 94, 0.25)",
            borderRadius: 10,
            padding: "10px 16px",
            color: "#1b6b45",
            fontSize: 13,
            fontWeight: 700,
            cursor: "default",
          }}
        >
          Recover
        </button>
        <button
          type="button"
          data-testid="simulate-reset"
          onClick={() => dispatch({ type: "reset" })}
          style={{
            background: "rgba(19, 37, 31, 0.08)",
            border: "1px solid rgba(19, 37, 31, 0.2)",
            borderRadius: 10,
            padding: "10px 16px",
            color: "#4d6156",
            fontSize: 13,
            fontWeight: 700,
            cursor: "default",
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}

export function DashboardView() {
  const [scenario, dispatch] = useReducer(scenarioReducer, undefined, initialScenarioState);

  const { data: logsData, error: logsError } = useSWR<{ logs: AuditLog[] }>(
    `${API_BASE}/admin/logs?limit=50`,
    fetcher,
    { refreshInterval: 5000, shouldRetryOnError: false }
  );
  const { data: budgetsData } = useSWR<{ budgets: BudgetInfo[] }>(
    `${API_BASE}/admin/budgets`,
    fetcher,
    { refreshInterval: 5000, shouldRetryOnError: false }
  );
  const { data: healthData } = useSWR<{ providers: Record<string, ProviderHealth> }>(
    `${API_BASE}/admin/health`,
    fetcher,
    { refreshInterval: 5000, shouldRetryOnError: false }
  );

  const forceDemo = isForceDemo();
  const loading = !forceDemo && !logsData && !logsError;
  // Demo mode kicks in when forced, or when the primary feed errors out (no backend).
  const demoMode = forceDemo || Boolean(logsError);

  const baseLogs = demoMode ? DEMO_LOGS : Array.isArray(logsData?.logs) ? logsData!.logs : [];
  const logs = demoMode ? [...scenario.logs, ...baseLogs] : baseLogs;

  const baseBudgets = demoMode
    ? DEMO_BUDGETS
    : Array.isArray(budgetsData?.budgets)
      ? budgetsData!.budgets
      : [];
  const budgets = demoMode ? scenario.budgets : baseBudgets;

  const baseHealth = demoMode ? DEMO_HEALTH : healthData?.providers;
  const healthSource = demoMode ? scenario.health : baseHealth;
  const health = normalizeHealth(healthSource);

  const { totalCost, avgLatency, blockedCount, requestCount } = summarize(logs);

  const chartHeight = 80;
  const chartWidth = 520;
  const { points: pointsString, maxLatency } = latencyPolyline(logs, chartWidth, chartHeight);
  const latencyCount = logs.slice(0, 15).length;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f4efe5", color: "#4d6156", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #0f5f57", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: 0.5 }}>Synchronizing with Gateway telemetry...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4efe5", color: "#13251f", fontFamily: "'Inter', system-ui, sans-serif", padding: "40px 24px", backgroundImage: "none" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {demoMode && <DemoBanner forceDemo={forceDemo} />}

        {/* Dynamic header with a beautiful live indicator */}
        <header className="console-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 40, borderBottom: "1px solid rgba(19, 37, 31, 0.12)", paddingBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: "-0.5px", color: "#13251f" }}>
                LLM Gateway Console
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: demoMode ? "rgba(138, 90, 18, 0.1)" : "rgba(27, 107, 69, 0.1)", border: demoMode ? "1px solid rgba(138, 90, 18, 0.2)" : "1px solid rgba(27, 107, 69, 0.2)", borderRadius: 20, padding: "4px 10px", fontSize: 12, fontWeight: 700, color: demoMode ? "#8a5a12" : "#1b6b45" }}>
                <span style={{ width: 6, height: 6, background: demoMode ? "#8a5a12" : "#1b6b45", borderRadius: "50%", display: "inline-block", boxShadow: demoMode ? "0 0 8px #8a5a12" : "0 0 8px #1b6b45", animation: "pulse 2s infinite" }} />
                {demoMode ? "DEMO" : "LIVE TAIL"}
              </div>
            </div>
            <p style={{ margin: "6px 0 0", color: "#5b6f63", fontSize: 14, fontWeight: 500 }}>
              AI proxy instrumentation, dynamic router execution, budgets, and provider SLA performance.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 12, color: "#5b6f63", textAlign: "right" }}>
              <div>HOST: <strong style={{ color: "#4d6156" }}>{API_BASE}</strong></div>
              <div style={{ marginTop: 2 }}>SECURITY: <strong style={{ color: "#1b6b45" }}>ACTIVE</strong></div>
            </div>
          </div>
        </header>

        {/* Dynamic pulse keyframe animation */}
        <style>{`
          @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(27, 107, 69, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(27, 107, 69, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(27, 107, 69, 0); }
          }
        `}</style>

        {demoMode && <SimulateRequestPanel dispatch={dispatch} />}

        {/* Telemetry Metric Cards */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginBottom: 40 }}>
          <HoverCard title="Proxy Request Count" value={String(requestCount)} subtitle="telemetry buffer length" accentColor="#0f5f57" glowColor="rgba(56, 189, 248, 0.15)" />
          <HoverCard title="Accumulated Cost" value={`$${totalCost.toFixed(4)}`} subtitle="last 50 requests" accentColor="#1b6b45" glowColor="rgba(27, 107, 69, 0.15)" />
          <HoverCard title="Average Latency" value={`${avgLatency}ms`} subtitle="last 50 responses" accentColor="#b8431f" glowColor="rgba(184, 67, 31, 0.15)" />
          <HoverCard title="Total Violations" value={String(blockedCount)} subtitle="policy & budget blocks" accentColor="#a33a2a" glowColor="rgba(163, 58, 42, 0.15)" />
        </section>

        {/* Central panel with telemetry graph & budgets */}
        <section className="console-two-col" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 28, marginBottom: 40 }}>

          {/* Telemetry latency graph */}
          <div style={{ background: "#fffdf8", border: "1px solid rgba(19, 37, 31, 0.16)", borderRadius: 16, padding: 24, boxShadow: "0 8px 24px rgba(19,37,31,0.08)", backdropFilter: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Latency Timeline</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#5b6f63" }}>Execution latency of the latest 15 operations</p>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#b8431f" }}>PEAK: {maxLatency}ms</span>
            </div>

            <div style={{ height: 100, display: "flex", alignItems: "flex-end", padding: "10px 0" }}>
              {latencyCount === 0 ? (
                <div style={{ width: "100%", textAlign: "center", fontSize: 13, color: "#5b6f63" }}>Insufficient timeline data</div>
              ) : (
                <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#b8431f" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#b8431f" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Grid Lines */}
                  <line x1="0" y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke="rgba(255,255,255,0.03)" strokeDasharray="4 4" />

                  {/* Glowing Area under line */}
                  <path
                    d={`M 0,${chartHeight} L ${pointsString} L ${chartWidth},${chartHeight} Z`}
                    fill="url(#glow)"
                  />

                  {/* Telemetry Line */}
                  <polyline
                    fill="none"
                    stroke="#b8431f"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pointsString}
                    style={{ filter: "drop-shadow(0px 4px 8px rgba(184, 67, 31, 0.4))" }}
                  />
                </svg>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#5b6f63", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 12, marginTop: 12 }}>
              <span>Older Requests</span>
              <span>Latest Request</span>
            </div>
          </div>

          {/* Budgets Section */}
          <div style={{ background: "#fffdf8", border: "1px solid rgba(19, 37, 31, 0.16)", borderRadius: 16, padding: 24, boxShadow: "0 8px 24px rgba(19,37,31,0.08)", backdropFilter: "none" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>Budget Allocation</h2>
            {budgets.length === 0 ? (
              <div style={{ color: "#5b6f63", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No budget pools configured in gateway</div>
            ) : (
              <div style={{ display: "flex", gap: 16, flexDirection: "column" }}>
                {budgets.map((b) => {
                  const usedPct = budgetUsedPct(b);
                  const isExceeded = b.usedUsd >= b.limitUsd;
                  return (
                    <div key={b.key} style={{ paddingBottom: 16, borderBottom: "1px solid rgba(19, 37, 31, 0.12)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</span>
                        <span style={{ fontSize: 12, color: "#5b6f63", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>{b.period}</span>
                      </div>

                      {/* Budget visual progress bar */}
                      <div style={{ height: 6, background: "rgba(19, 37, 31, 0.10)", borderRadius: 3, margin: "8px 0", overflow: "hidden" }}>
                        <div style={{ width: `${usedPct}%`, height: "100%", background: isExceeded ? "#a33a2a" : "linear-gradient(90deg, #0f5f57, #1b6b45)", borderRadius: 3, boxShadow: isExceeded ? "0 0 10px #a33a2a" : "none", transition: "width 0.5s ease" }} />
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#5b6f63" }}>
                        <span>Limit: <strong style={{ color: "#13251f" }}>${b.limitUsd.toFixed(2)}</strong></span>
                        <span>Used: <strong style={{ color: isExceeded ? "#a33a2a" : "#1b6b45" }}>${b.usedUsd.toFixed(2)}</strong></span>
                        <span>Rem: <strong style={{ color: "#0f5f57" }}>${b.remainingUsd.toFixed(2)}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Detailed audit logs list */}
        <section style={{ background: "#fffdf8", border: "1px solid rgba(19, 37, 31, 0.16)", borderRadius: 16, padding: 24, marginBottom: 40, boxShadow: "0 8px 24px rgba(19,37,31,0.08)", backdropFilter: "none" }}>
          <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 800 }}>Audit Logs buffer</h2>

          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Audit log entries">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ color: "#5b6f63", borderBottom: "1px solid rgba(19, 37, 31, 0.16)" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>MODEL TYPE</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>ROUTING DECISION</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>STATUS</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>TRANSACTION COST</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>LATENCY</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 40, textShadow: "none", color: "#5b6f63", textAlign: "center" }}>No logs currently in buffer</td>
                  </tr>
                ) : (
                  logs.map((d) => {
                    const isSuccess = d.status === "success" || d.status === "completed";
                    const isPolicyBlocked = d.status === "policy_denied" || d.status === "budget_exceeded" || d.status === "error";

                    return (
                      <tr key={d.id} data-testid={`audit-row-${d.id}`} style={{ borderBottom: "1px solid rgba(19, 37, 31, 0.08)", transition: "background 0.2s" }} className="log-row">
                        <td style={{ padding: "14px 16px", fontWeight: 650, color: "#13251f" }}>
                          {d.model}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{
                            display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                            background: d.provider === "openai" ? "rgba(15, 95, 87, 0.1)" : d.provider === "anthropic" ? "rgba(15, 95, 87, 0.1)" : "rgba(184, 67, 31, 0.1)",
                            color: d.provider === "openai" ? "#0f5f57" : d.provider === "anthropic" ? "#0f5f57" : "#8f3618",
                            border: d.provider === "openai" ? "1px solid rgba(15, 95, 87, 0.15)" : d.provider === "anthropic" ? "1px solid rgba(15, 95, 87, 0.15)" : "1px solid rgba(184, 67, 31, 0.15)"
                          }}>
                            {d.provider.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: 12, fontWeight: 700 }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: 6,
                            background: isSuccess ? "rgba(27, 107, 69, 0.08)" : isPolicyBlocked ? "rgba(163, 58, 42, 0.08)" : "rgba(138, 90, 18, 0.08)",
                            color: isSuccess ? "#1b6b45" : isPolicyBlocked ? "#a33a2a" : "#8a5a12",
                            border: isSuccess ? "1px solid rgba(27, 107, 69, 0.12)" : isPolicyBlocked ? "1px solid rgba(163, 58, 42, 0.12)" : "1px solid rgba(138, 90, 18, 0.12)"
                          }}>
                            {d.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1b6b45" }}>
                          ${(d.costUsd || 0).toFixed(4)}
                        </td>
                        <td style={{ padding: "14px 16px", color: d.latencyMs > 1000 ? "#b8431f" : "#13251f", fontWeight: 600 }}>
                          {d.latencyMs}ms
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Provider health listings */}
        <section style={{ background: "#fffdf8", border: "1px solid rgba(19, 37, 31, 0.16)", borderRadius: 16, padding: 24, boxShadow: "0 8px 24px rgba(19,37,31,0.08)", backdropFilter: "none" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>Core Adapter Status</h2>
          {health.length === 0 ? (
            <div style={{ color: "#5b6f63", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No provider health data available</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
              {health.map((h) => {
                const isHealthy = h.status === "healthy";
                return (
                  <div key={h.name} style={{ background: "#fffdf8", border: "1px solid rgba(19, 37, 31, 0.10)", borderRadius: 12, padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>{h.name.toUpperCase()}</span>
                      <span style={{
                        fontSize: 12, padding: "3px 10px", borderRadius: 20, fontWeight: 700,
                        background: isHealthy ? "rgba(27, 107, 69, 0.1)" : "rgba(163, 58, 42, 0.1)",
                        color: isHealthy ? "#1b6b45" : "#a33a2a",
                        border: isHealthy ? "1px solid rgba(27, 107, 69, 0.15)" : "1px solid rgba(163, 58, 42, 0.15)",
                      }}>{h.status.toUpperCase()}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12, color: "#5b6f63" }}>
                      <div>ERROR RATIO: <strong style={{ color: "#13251f" }}>{(h.errorRate * 100).toFixed(1)}%</strong></div>
                      <div>LATENCY: <strong style={{ color: "#13251f" }}>{h.latencyMs}ms</strong></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
