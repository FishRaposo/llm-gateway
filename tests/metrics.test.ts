import { describe, expect, it, beforeEach } from "vitest";
import {
  recordGatewayError,
  recordGatewayRequest,
  renderPrometheusMetrics,
  resetMetricsForTests,
} from "../src/metrics";

describe("Prometheus metrics", () => {
  beforeEach(() => {
    resetMetricsForTests();
  });

  it("renders gateway request counters, cost, and latency histogram", () => {
    recordGatewayRequest({
      status: "success",
      provider: "mock",
      model: "gpt-4o-mini",
      cacheHit: false,
      fallbackUsed: true,
      durationMs: 123,
      costUsd: 0.0042,
    });

    const output = renderPrometheusMetrics();

    expect(output).toContain("# TYPE llm_gateway_requests_total counter");
    expect(output).toContain('llm_gateway_requests_total{cache_hit="false",fallback_used="true",model="gpt-4o-mini",provider="mock",status="success"} 1');
    expect(output).toContain('llm_gateway_cost_usd_total{model="gpt-4o-mini",provider="mock"} 0.0042');
    expect(output).toContain('llm_gateway_request_duration_ms_bucket{cache_hit="false",fallback_used="true",le="250",model="gpt-4o-mini",provider="mock",status="success"} 1');
    expect(output).toContain('llm_gateway_last_request_duration_ms{cache_hit="false",fallback_used="true",model="gpt-4o-mini",provider="mock",status="success"} 123');
  });

  it("renders provider and gateway errors", () => {
    recordGatewayError("provider_error", "openai", "gpt-4o");
    recordGatewayError("provider_error", "openai", "gpt-4o");

    const output = renderPrometheusMetrics();

    expect(output).toContain("# TYPE llm_gateway_errors_total counter");
    expect(output).toContain('llm_gateway_errors_total{model="gpt-4o",provider="openai",type="provider_error"} 2');
  });
});
