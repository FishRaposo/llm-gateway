"use client";

import { useState } from "react";
import useSWR from "swr";

interface AuditLog {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  cost_usd: number;
  latency_ms: number;
  status: string;
  fallback_used: number;
  routing_decision?: string;
}

interface BudgetInfo {
  key: string;
  name: string;
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  period: string;
}

interface ProviderHealth {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  errorRate: number;
  lastCheck: string;
}

const API_BASE = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_GATEWAY_API_KEY || "gateway-admin-key";

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
  accentColor = "#06b6d4",
  glowColor = "rgba(6, 182, 212, 0.15)",
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
          ? "linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)"
          : "linear-gradient(135deg, rgba(30, 41, 59, 0.3) 0%, rgba(15, 23, 42, 0.5) 100%)",
        border: hovered ? `1px solid ${accentColor}` : "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 16,
        padding: "24px 20px",
        minWidth: 200,
        boxShadow: hovered
          ? `0 12px 30px 0 ${glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`
          : "0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        backdropFilter: "blur(12px)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "pointer",
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
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.5, color: "#94a3b8", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: hovered ? "#ffffff" : accentColor, textShadow: hovered ? `0 0 15px ${accentColor}` : "none", transition: "all 0.3s ease" }}>
        {value}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontWeight: 500 }}>{subtitle}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: logsData, error: logsError } = useSWR<{ logs: AuditLog[] }>(
    `${API_BASE}/admin/logs?limit=50`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: budgetsData, error: budgetsError } = useSWR<{ budgets: BudgetInfo[] }>(
    `${API_BASE}/admin/budgets`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: healthData, error: healthError } = useSWR<{ providers: Record<string, ProviderHealth> }>(
    `${API_BASE}/admin/health`,
    fetcher,
    { refreshInterval: 5000 }
  );

  const logs = Array.isArray(logsData?.logs) ? logsData.logs : [];
  const budgets = Array.isArray(budgetsData?.budgets) ? budgetsData.budgets : [];
  const health = healthData?.providers
    ? Object.entries(healthData.providers).map(([name, info]) => ({
        name,
        status: info.status || "unknown",
        latencyMs: info.latencyMs || 0,
        errorRate: info.errorRate || 0,
        lastCheck: info.lastCheck || new Date().toISOString(),
      }))
    : [];

  const loading = !logsData && !logsError;
  const error = logsError || budgetsError || healthError;

  const totalCost = logs.reduce((sum, d) => sum + (d.cost_usd || 0), 0);
  const avgLatency = logs.length > 0 ? Math.round(logs.reduce((sum, d) => sum + (d.latency_ms || 0), 0) / logs.length) : 0;
  const blockedCount = logs.filter((g) => g.status === "policy_denied" || g.status === "budget_exceeded").length;

  // Render visual telemetry charts
  const latencyPoints = logs.slice(0, 15).reverse().map((log) => log.latency_ms);
  const chartHeight = 80;
  const chartWidth = 520;
  const maxLatency = latencyPoints.length > 0 ? Math.max(...latencyPoints, 500) : 1000;
  const pointsString = latencyPoints
    .map((lat, idx) => {
      const x = (idx / Math.max(latencyPoints.length - 1, 1)) * chartWidth;
      const y = chartHeight - (lat / maxLatency) * chartHeight * 0.8 - 5;
      return `${x},${y}`;
    })
    .join(" ");

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#060813", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #06b6d4", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: 0.5 }}>Synchronizing with Gateway telemetry...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#060813", color: "#f87171", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", padding: 24 }}>
        <div style={{ background: "rgba(248, 113, 113, 0.05)", border: "1px solid rgba(248, 113, 113, 0.2)", borderRadius: 16, padding: 32, maxWidth: 500, width: "100%", textAlign: "center" }}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 48, height: 48, margin: "0 auto 16px" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>Operational Disconnection</h2>
          <p style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.6, marginBottom: 24 }}>
            Could not load metrics: {error instanceof Error ? error.message : String(error)}. Ensure your LLM Gateway container is online.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#06b6d4", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 650, cursor: "pointer", transition: "background 0.2s" }}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#060813", color: "#f8fafc", fontFamily: "'Inter', system-ui, sans-serif", padding: "40px 24px", backgroundImage: "radial-gradient(circle at 50% 0%, rgba(6, 182, 212, 0.08) 0%, transparent 50%)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        
        {/* Dynamic header with a beautiful live indicator */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 40, borderBottom: "1px solid rgba(255, 255, 255, 0.05)", paddingBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: "-0.5px", background: "linear-gradient(to right, #ffffff, #94a3b8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                LLM Gateway Console
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: 20, padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "#34d399" }}>
                <span style={{ width: 6, height: 6, background: "#10b981", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px #10b981", animation: "pulse 2s infinite" }} />
                LIVE TAIL
              </div>
            </div>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14, fontWeight: 500 }}>
              AI proxy instrumentation, dynamic router execution, budgets, and provider SLA performance.
            </p>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 11, color: "#475569", textAlign: "right" }}>
              <div>HOST: <strong style={{ color: "#94a3b8" }}>{API_BASE}</strong></div>
              <div style={{ marginTop: 2 }}>SECURITY: <strong style={{ color: "#34d399" }}>ACTIVE</strong></div>
            </div>
          </div>
        </header>

        {/* Dynamic pulse keyframe animation */}
        <style>{`
          @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          }
        `}</style>

        {/* Telemetry Metric Cards */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginBottom: 40 }}>
          <HoverCard title="Proxy Request Count" value={String(logs.length)} subtitle="telemetry buffer length" accentColor="#38bdf8" glowColor="rgba(56, 189, 248, 0.15)" />
          <HoverCard title="Accumulated Cost" value={`$${totalCost.toFixed(4)}`} subtitle="last 50 requests" accentColor="#10b981" glowColor="rgba(16, 185, 129, 0.15)" />
          <HoverCard title="Average Latency" value={`${avgLatency}ms`} subtitle="last 50 responses" accentColor="#ec4899" glowColor="rgba(236, 72, 153, 0.15)" />
          <HoverCard title="Total Violations" value={String(blockedCount)} subtitle="policy & budget blocks" accentColor="#f43f5e" glowColor="rgba(244, 63, 94, 0.15)" />
        </section>

        {/* Central panel with telemetry graph & budgets */}
        <section style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 28, marginBottom: 40 }}>
          
          {/* Telemetry latency graph */}
          <div style={{ background: "linear-gradient(135deg, rgba(30, 41, 59, 0.3) 0%, rgba(15, 23, 42, 0.5) 100%)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 16, padding: 24, boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)", backdropFilter: "blur(12px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Latency Timeline</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>Execution latency of the latest 15 operations</p>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#ec4899" }}>PEAK: {maxLatency}ms</span>
            </div>
            
            <div style={{ height: 100, display: "flex", alignItems: "flex-end", padding: "10px 0" }}>
              {latencyPoints.length === 0 ? (
                <div style={{ width: "100%", textAlign: "center", fontSize: 13, color: "#475569" }}>Insufficient timeline data</div>
              ) : (
                <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
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
                    stroke="#ec4899"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pointsString}
                    style={{ filter: "drop-shadow(0px 4px 8px rgba(236, 72, 153, 0.4))" }}
                  />
                </svg>
              )}
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 12, marginTop: 12 }}>
              <span>Older Requests</span>
              <span>Latest Request</span>
            </div>
          </div>

          {/* Budgets Section */}
          <div style={{ background: "linear-gradient(135deg, rgba(30, 41, 59, 0.3) 0%, rgba(15, 23, 42, 0.5) 100%)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 16, padding: 24, boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)", backdropFilter: "blur(12px)" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>Budget Allocation</h2>
            {budgets.length === 0 ? (
              <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No budget pools configured in gateway</div>
            ) : (
              <div style={{ display: "flex", gap: 16, flexDirection: "column" }}>
                {budgets.map((b) => {
                  const usedPct = Math.min((b.usedUsd / b.limitUsd) * 100, 100);
                  const isExceeded = b.usedUsd >= b.limitUsd;
                  return (
                    <div key={b.key} style={{ paddingBottom: 16, borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</span>
                        <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>{b.period}</span>
                      </div>
                      
                      {/* Budget visual progress bar */}
                      <div style={{ height: 6, background: "rgba(255, 255, 255, 0.04)", borderRadius: 3, margin: "8px 0", overflow: "hidden" }}>
                        <div style={{ width: `${usedPct}%`, height: "100%", background: isExceeded ? "#f43f5e" : "linear-gradient(90deg, #06b6d4, #10b981)", borderRadius: 3, boxShadow: isExceeded ? "0 0 10px #f43f5e" : "none", transition: "width 0.5s ease" }} />
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
                        <span>Limit: <strong style={{ color: "#fff" }}>${b.limitUsd.toFixed(2)}</strong></span>
                        <span>Used: <strong style={{ color: isExceeded ? "#f43f5e" : "#34d399" }}>${b.usedUsd.toFixed(2)}</strong></span>
                        <span>Rem: <strong style={{ color: "#38bdf8" }}>${b.remainingUsd.toFixed(2)}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Detailed audit logs list */}
        <section style={{ background: "linear-gradient(135deg, rgba(30, 41, 59, 0.3) 0%, rgba(15, 23, 42, 0.5) 100%)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 16, padding: 24, marginBottom: 40, boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)", backdropFilter: "blur(12px)" }}>
          <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 800 }}>Audit Logs buffer</h2>
          
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ color: "#64748b", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
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
                    <td colSpan={5} style={{ padding: 40, textShadow: "none", color: "#475569", textAlign: "center" }}>No logs currently in buffer</td>
                  </tr>
                ) : (
                  logs.map((d) => {
                    const isSuccess = d.status === "success" || d.status === "completed";
                    const isPolicyBlocked = d.status === "policy_denied" || d.status === "budget_exceeded" || d.status === "error";
                    
                    return (
                      <tr key={d.id} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.03)", transition: "background 0.2s" }} className="log-row">
                        <td style={{ padding: "14px 16px", fontWeight: 650, color: "#f8fafc" }}>
                          {d.model}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{
                            display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                            background: d.provider === "openai" ? "rgba(6, 182, 212, 0.1)" : d.provider === "anthropic" ? "rgba(139, 92, 246, 0.1)" : "rgba(236, 72, 153, 0.1)",
                            color: d.provider === "openai" ? "#22d3ee" : d.provider === "anthropic" ? "#a78bfa" : "#f472b6",
                            border: d.provider === "openai" ? "1px solid rgba(6, 182, 212, 0.15)" : d.provider === "anthropic" ? "1px solid rgba(139, 92, 246, 0.15)" : "1px solid rgba(236, 72, 153, 0.15)"
                          }}>
                            {d.provider.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: 11, fontWeight: 700 }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: 6,
                            background: isSuccess ? "rgba(16, 185, 129, 0.08)" : isPolicyBlocked ? "rgba(244, 63, 94, 0.08)" : "rgba(245, 158, 11, 0.08)",
                            color: isSuccess ? "#34d399" : isPolicyBlocked ? "#f43f5e" : "#f59e0b",
                            border: isSuccess ? "1px solid rgba(16, 185, 129, 0.12)" : isPolicyBlocked ? "1px solid rgba(244, 63, 94, 0.12)" : "1px solid rgba(245, 158, 11, 0.12)"
                          }}>
                            {d.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", fontWeight: 600, color: "#10b981" }}>
                          ${(d.cost_usd || 0).toFixed(4)}
                        </td>
                        <td style={{ padding: "14px 16px", color: d.latency_ms > 1000 ? "#ec4899" : "#fff", fontWeight: 600 }}>
                          {d.latency_ms}ms
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
        <section style={{ background: "linear-gradient(135deg, rgba(30, 41, 59, 0.3) 0%, rgba(15, 23, 42, 0.5) 100%)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 16, padding: 24, boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)", backdropFilter: "blur(12px)" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>Core Adapter Status</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            {health.map((h) => {
              const isHealthy = h.status === "healthy";
              return (
                <div key={h.name} style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.04)", borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{h.name.toUpperCase()}</span>
                    <span style={{
                      fontSize: 10, padding: "3px 10px", borderRadius: 20, fontWeight: 700,
                      background: isHealthy ? "rgba(16, 185, 129, 0.1)" : "rgba(244, 63, 94, 0.1)",
                      color: isHealthy ? "#34d399" : "#f43f5e",
                      border: isHealthy ? "1px solid rgba(16, 185, 129, 0.15)" : "1px solid rgba(244, 63, 94, 0.15)",
                    }}>{h.status.toUpperCase()}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12, color: "#64748b" }}>
                    <div>ERROR RATIO: <strong style={{ color: "#f8fafc" }}>{(h.errorRate * 100).toFixed(1)}%</strong></div>
                    <div>LATENCY: <strong style={{ color: "#f8fafc" }}>{h.latencyMs}ms</strong></div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
