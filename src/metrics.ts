/** Lightweight Prometheus metrics registry for the gateway. */

type Labels = Record<string, string | number | boolean | undefined>;

interface RequestMetric {
  status: string;
  provider: string;
  model: string;
  cacheHit: boolean;
  fallbackUsed: boolean;
  durationMs: number;
  costUsd: number;
}

const latencyBuckets = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapeLabel(String(value))}"`)
    .join(",");
}

function metricKey(name: string, labels: Labels = {}): string {
  const labelsText = labelKey(labels);
  return labelsText ? `${name}{${labelsText}}` : name;
}

function inc(name: string, labels: Labels = {}, amount = 1): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

function setGauge(name: string, labels: Labels = {}, value: number): void {
  gauges.set(metricKey(name, labels), value);
}

export function recordGatewayRequest(metric: RequestMetric): void {
  const labels = {
    status: metric.status,
    provider: metric.provider || "unknown",
    model: metric.model || "unknown",
    cache_hit: metric.cacheHit,
    fallback_used: metric.fallbackUsed,
  };

  inc("llm_gateway_requests_total", labels);
  inc("llm_gateway_cost_usd_total", { provider: labels.provider, model: labels.model }, metric.costUsd);
  setGauge("llm_gateway_last_request_duration_ms", labels, metric.durationMs);

  for (const bucket of latencyBuckets) {
    if (metric.durationMs <= bucket) {
      inc("llm_gateway_request_duration_ms_bucket", { ...labels, le: bucket });
    }
  }
  inc("llm_gateway_request_duration_ms_bucket", { ...labels, le: "+Inf" });
  inc("llm_gateway_request_duration_ms_count", labels);
  inc("llm_gateway_request_duration_ms_sum", labels, metric.durationMs);
}

export function recordGatewayError(type: string, provider = "unknown", model = "unknown"): void {
  inc("llm_gateway_errors_total", { type, provider, model });
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [
    "# HELP llm_gateway_requests_total Total gateway requests by status and routing outcome.",
    "# TYPE llm_gateway_requests_total counter",
  ];

  for (const [key, value] of counters) {
    if (key.startsWith("llm_gateway_requests_total")) lines.push(`${key} ${value}`);
  }

  lines.push(
    "# HELP llm_gateway_errors_total Total gateway errors by type.",
    "# TYPE llm_gateway_errors_total counter",
  );
  for (const [key, value] of counters) {
    if (key.startsWith("llm_gateway_errors_total")) lines.push(`${key} ${value}`);
  }

  lines.push(
    "# HELP llm_gateway_cost_usd_total Estimated gateway spend in USD.",
    "# TYPE llm_gateway_cost_usd_total counter",
  );
  for (const [key, value] of counters) {
    if (key.startsWith("llm_gateway_cost_usd_total")) lines.push(`${key} ${value}`);
  }

  lines.push(
    "# HELP llm_gateway_request_duration_ms Request latency histogram in milliseconds.",
    "# TYPE llm_gateway_request_duration_ms histogram",
  );
  for (const [key, value] of counters) {
    if (key.startsWith("llm_gateway_request_duration_ms_")) lines.push(`${key} ${value}`);
  }

  lines.push(
    "# HELP llm_gateway_last_request_duration_ms Most recent request latency in milliseconds.",
    "# TYPE llm_gateway_last_request_duration_ms gauge",
  );
  for (const [key, value] of gauges) {
    lines.push(`${key} ${value}`);
  }

  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests(): void {
  counters.clear();
  gauges.clear();
}
