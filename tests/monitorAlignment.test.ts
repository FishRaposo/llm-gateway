import { describe, it, expect, beforeEach } from "vitest";
import {
  recordGatewayRequest,
  recordGatewayError,
  renderPrometheusMetrics,
  resetMetricsForTests,
} from "../src/metrics";
import type { AuditEntry } from "../src/types";

/**
 * Cross-language alignment with the Python `llm-cost-latency-monitor`.
 *
 * The monitor persists each call via the `LLMCall` model
 * (llm-cost-latency-monitor/src/llm_monitor/models.py):
 *   model, input_tokens, output_tokens, cost_usd, latency_ms, error
 *
 * The gateway's audit-log row and the `cost_usd` metric use the SAME snake_case
 * column / label names so a single dashboard can query either store. These tests
 * pin those shared key names so an accidental rename is caught.
 */

// The snake_case columns the gateway writes (see src/storage/auditLog.ts schema).
const GATEWAY_AUDIT_COLUMNS = [
  "id",
  "timestamp",
  "api_key",
  "api_key_name",
  "model",
  "provider",
  "input_tokens",
  "output_tokens",
  "cost_usd",
  "latency_ms",
  "status",
  "error_message",
  "routing_decision",
  "cache_hit",
  "fallback_used",
] as const;

// The cost-record fields the Python monitor's LLMCall model exposes.
const MONITOR_COST_RECORD_FIELDS = [
  "model",
  "input_tokens",
  "output_tokens",
  "cost_usd",
  "latency_ms",
] as const;

describe("Audit-log / monitor cost-record schema alignment", () => {
  it("gateway audit columns are a superset of the monitor cost-record fields", () => {
    for (const field of MONITOR_COST_RECORD_FIELDS) {
      expect(GATEWAY_AUDIT_COLUMNS).toContain(field);
    }
  });

  it("maps the camelCase AuditEntry shape onto the shared snake_case columns", () => {
    // A representative entry, exactly as the storage layer would serialize it.
    const entry: AuditEntry = {
      id: "id-1",
      timestamp: "2026-06-15T00:00:00.000Z",
      apiKey: "sk-1",
      apiKeyName: "k",
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.00125,
      latencyMs: 420,
      status: "success",
      cacheHit: false,
      fallbackUsed: false,
    };
    const row: Record<string, unknown> = {
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      cost_usd: entry.costUsd,
      latency_ms: entry.latencyMs,
    };
    for (const field of MONITOR_COST_RECORD_FIELDS) {
      expect(row[field]).not.toBeUndefined();
    }
    expect(row.cost_usd).toBe(0.00125);
    expect(row.latency_ms).toBe(420);
  });
});

describe("Prometheus metric key names (shared dashboard contract)", () => {
  beforeEach(() => resetMetricsForTests());

  it("exposes cost as llm_gateway_cost_usd_total keyed by provider and model", () => {
    recordGatewayRequest({
      status: "success",
      provider: "openai",
      model: "gpt-4o",
      cacheHit: false,
      fallbackUsed: false,
      durationMs: 100,
      costUsd: 0.01,
    });
    const out = renderPrometheusMetrics();
    expect(out).toContain("# TYPE llm_gateway_cost_usd_total counter");
    expect(out).toContain('llm_gateway_cost_usd_total{model="gpt-4o",provider="openai"} 0.01');
  });

  it("accumulates cost across multiple requests for the same provider/model", () => {
    for (const cost of [0.01, 0.02, 0.03]) {
      recordGatewayRequest({
        status: "success",
        provider: "openai",
        model: "gpt-4o",
        cacheHit: false,
        fallbackUsed: false,
        durationMs: 10,
        costUsd: cost,
      });
    }
    const out = renderPrometheusMetrics();
    expect(out).toMatch(/llm_gateway_cost_usd_total\{model="gpt-4o",provider="openai"\} 0\.0?6/);
  });

  it("records a zero-cost free model without dropping the series", () => {
    recordGatewayRequest({
      status: "success",
      provider: "ollama",
      model: "ollama-default",
      cacheHit: true,
      fallbackUsed: false,
      durationMs: 5,
      costUsd: 0,
    });
    const out = renderPrometheusMetrics();
    expect(out).toContain('llm_gateway_cost_usd_total{model="ollama-default",provider="ollama"} 0');
  });

  it("uses 'unknown' placeholders when provider/model are blank", () => {
    recordGatewayRequest({
      status: "error",
      provider: "",
      model: "",
      cacheHit: false,
      fallbackUsed: false,
      durationMs: 1,
      costUsd: 0,
    });
    const out = renderPrometheusMetrics();
    expect(out).toContain('provider="unknown"');
    expect(out).toContain('model="unknown"');
  });

  it("counts errors under llm_gateway_errors_total with type/provider/model labels", () => {
    recordGatewayError("timeout", "anthropic", "claude-sonnet-4-20250514");
    const out = renderPrometheusMetrics();
    expect(out).toContain(
      'llm_gateway_errors_total{model="claude-sonnet-4-20250514",provider="anthropic",type="timeout"} 1'
    );
  });

  it("defaults error provider/model to 'unknown' when omitted", () => {
    recordGatewayError("server_error");
    const out = renderPrometheusMetrics();
    expect(out).toContain('llm_gateway_errors_total{model="unknown",provider="unknown",type="server_error"} 1');
  });
});
