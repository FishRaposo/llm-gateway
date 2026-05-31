"use client";

import { useEffect, useState } from "react";

interface RouteDecision {
  id: string;
  timestamp: string;
  query: string;
  provider: string;
  model: string;
  ruleMatched: string;
  costUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

interface GuardrailHit {
  id: string;
  timestamp: string;
  check: string;
  severity: string;
  reason: string;
  allowed: boolean;
}

interface ProviderHealth {
  name: string;
  status: "healthy" | "degraded" | "down";
  successRate: number;
  avgLatencyMs: number;
  totalRequests: number;
}

// Mock data for demo / local run without real gateway
const mockDecisions: RouteDecision[] = [
  { id: "r1", timestamp: new Date().toISOString(), query: "Explain quantum computing", provider: "openai", model: "gpt-4o-mini", ruleMatched: "cost_optimize:chat:openai", costUsd: 0.0012, latencyMs: 420, fallbackUsed: false },
  { id: "r2", timestamp: new Date(Date.now() - 30000).toISOString(), query: "Code review this Python function", provider: "anthropic", model: "claude-sonnet-4-20250514", ruleMatched: "model_preference:code", costUsd: 0.0034, latencyMs: 890, fallbackUsed: false },
  { id: "r3", timestamp: new Date(Date.now() - 120000).toISOString(), query: "Write a marketing email", provider: "openai", model: "gpt-3.5-turbo", ruleMatched: "cost_optimize:creative:openai", costUsd: 0.0008, latencyMs: 310, fallbackUsed: false },
];

const mockGuardrails: GuardrailHit[] = [
  { id: "g1", timestamp: new Date().toISOString(), check: "pii_detection", severity: "warning", reason: "Flagged 1 email instance", allowed: true },
  { id: "g2", timestamp: new Date(Date.now() - 60000).toISOString(), check: "prompt_injection", severity: "critical", reason: "Possible prompt injection pattern detected", allowed: false },
  { id: "g3", timestamp: new Date(Date.now() - 120000).toISOString(), check: "toxicity", severity: "info", reason: "Toxicity score 0.12 < 0.85", allowed: true },
];

const mockHealth: ProviderHealth[] = [
  { name: "OpenAI", status: "healthy", successRate: 99.2, avgLatencyMs: 450, totalRequests: 12450 },
  { name: "Anthropic", status: "healthy", successRate: 98.7, avgLatencyMs: 720, totalRequests: 8320 },
];

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
  const [decisions, setDecisions] = useState<RouteDecision[]>(mockDecisions);
  const [guardrails, setGuardrails] = useState<GuardrailHit[]>(mockGuardrails);
  const [health, setHealth] = useState<ProviderHealth[]>(mockHealth);

  useEffect(() => {
    // In production, fetch from /api/admin/decisions, /api/admin/guardrails, /metrics
    setDecisions(mockDecisions);
    setGuardrails(mockGuardrails);
    setHealth(mockHealth);
  }, []);

  const totalCost = decisions.reduce((sum, d) => sum + d.costUsd, 0);
  const avgLatency = decisions.length > 0 ? Math.round(decisions.reduce((sum, d) => sum + d.latencyMs, 0) / decisions.length) : 0;
  const blockedCount = guardrails.filter((g) => !g.allowed).length;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>LLM Gateway Dashboard</h1>
        <p style={{ margin: "4px 0 0", color: "#94a3b8" }}>Routing decisions, guardrails, and cost analytics</p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
        <Card title="Requests Today" value="12.4k" subtitle="+8% vs yesterday" />
        <Card title="Total Cost" value={`$${totalCost.toFixed(4)}`} subtitle="Last hour" color="#4ade80" />
        <Card title="Avg Latency" value={`${avgLatency}ms`} subtitle="p95: 1.2s" color="#f472b6" />
        <Card title="Guardrail Blocks" value={String(blockedCount)} subtitle="2 warnings" color="#f87171" />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 20 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Recent Routing Decisions</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: "#94a3b8", textAlign: "left", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "8px 0" }}>Query</th>
                <th style={{ padding: "8px 0" }}>Provider</th>
                <th style={{ padding: "8px 0" }}>Rule</th>
                <th style={{ padding: "8px 0" }}>Cost</th>
                <th style={{ padding: "8px 0" }}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "8px 0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.query}</td>
                  <td style={{ padding: "8px 0" }}><span style={{ color: d.provider === "openai" ? "#38bdf8" : "#f472b6" }}>{d.provider}</span></td>
                  <td style={{ padding: "8px 0", fontSize: 12, color: "#64748b" }}>{d.ruleMatched}</td>
                  <td style={{ padding: "8px 0" }}>${d.costUsd.toFixed(4)}</td>
                  <td style={{ padding: "8px 0" }}>{d.latencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: "#1e293b", borderRadius: 8, padding: 20 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Guardrail Events</h2>
          {guardrails.map((g) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #334155" }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: g.allowed ? "#4ade80" : "#f87171",
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{g.check}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{g.reason}</div>
              </div>
              <div style={{
                fontSize: 11, textTransform: "uppercase", padding: "2px 8px", borderRadius: 4,
                background: g.severity === "critical" ? "#7f1d1d" : g.severity === "warning" ? "#713f12" : "#1e3a5f",
                color: g.severity === "critical" ? "#fca5a5" : g.severity === "warning" ? "#fde047" : "#93c5fd",
              }}>{g.severity}</div>
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
                <div>Success: <strong style={{ color: "#e2e8f0" }}>{h.successRate}%</strong></div>
                <div>Latency: <strong style={{ color: "#e2e8f0" }}>{h.avgLatencyMs}ms</strong></div>
                <div>Requests: <strong style={{ color: "#e2e8f0" }}>{h.totalRequests.toLocaleString()}</strong></div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
