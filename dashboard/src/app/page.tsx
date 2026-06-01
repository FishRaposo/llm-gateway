"use client";

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

function Card({ title, value, subtitle, color = "#38bdf8" }: { title: string; value: string; subtitle?: string; color?: string }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: 8, padding: 20, minWidth: 180 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{subtitle}</div>}
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

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px", color: "#94a3b8" }}>
        Loading live dashboard data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px", color: "#f87171" }}>
        Error loading dashboard: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>LLM Gateway Dashboard</h1>
        <p style={{ margin: "4px 0 0", color: "#94a3b8" }}>Routing decisions, budgets, and provider health</p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
        <Card title="Requests" value={String(logs.length)} subtitle="Last 50" />
        <Card title="Total Cost" value={`$${totalCost.toFixed(4)}`} subtitle="Last 50 requests" color="#4ade80" />
        <Card title="Avg Latency" value={`${avgLatency}ms`} subtitle="Last 50 requests" color="#f472b6" />
        <Card title="Blocks / Denials" value={String(blockedCount)} subtitle="Policy / budget / rate limit" color="#f87171" />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 20 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Recent Audit Logs</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: "#94a3b8", textAlign: "left", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "8px 0" }}>Model</th>
                <th style={{ padding: "8px 0" }}>Provider</th>
                <th style={{ padding: "8px 0" }}>Status</th>
                <th style={{ padding: "8px 0" }}>Cost</th>
                <th style={{ padding: "8px 0" }}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "8px 0" }}>{d.model}</td>
                  <td style={{ padding: "8px 0" }}>
                    <span style={{ color: d.provider === "openai" ? "#38bdf8" : d.provider === "anthropic" ? "#f472b6" : "#a78bfa" }}>
                      {d.provider}
                    </span>
                  </td>
                  <td style={{ padding: "8px 0", fontSize: 12, color: "#64748b" }}>{d.status}</td>
                  <td style={{ padding: "8px 0" }}>${(d.cost_usd || 0).toFixed(4)}</td>
                  <td style={{ padding: "8px 0" }}>{d.latency_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: "#1e293b", borderRadius: 8, padding: 20 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Budgets</h2>
          {budgets.length === 0 && <div style={{ color: "#64748b", fontSize: 14 }}>No budgets configured</div>}
          {budgets.map((b) => (
            <div key={b.key} style={{ padding: "10px 0", borderBottom: "1px solid #334155" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600 }}>{b.name}</span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{b.period}</span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#64748b", marginTop: 4 }}>
                <span>Limit: <strong style={{ color: "#e2e8f0" }}>${b.limitUsd.toFixed(2)}</strong></span>
                <span>Used: <strong style={{ color: "#fca5a5" }}>${b.usedUsd.toFixed(2)}</strong></span>
                <span>Remaining: <strong style={{ color: "#6ee7b7" }}>${b.remainingUsd.toFixed(2)}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "#1e293b", borderRadius: 8, padding: 20 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Provider Health</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {health.map((h) => (
            <div key={h.name} style={{ background: "#0f172a", borderRadius: 6, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{h.name}</span>
                <span style={{
                  fontSize: 12, padding: "2px 8px", borderRadius: 4,
                  background: h.status === "healthy" ? "#064e3b" : "#7f1d1d",
                  color: h.status === "healthy" ? "#6ee7b7" : "#fca5a5",
                }}>{h.status}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, color: "#94a3b8" }}>
                <div>Error rate: <strong style={{ color: "#e2e8f0" }}>{(h.errorRate * 100).toFixed(1)}%</strong></div>
                <div>Latency: <strong style={{ color: "#e2e8f0" }}>{h.latencyMs}ms</strong></div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
