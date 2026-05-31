#!/usr/bin/env tsx
/** Benchmark script for LLM Gateway performance testing. */

import { performance } from "perf_hooks";

const BASE_URL = "http://localhost:3000";

interface BenchmarkResult {
  endpoint: string;
  iterations: number;
  errors: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

async function benchmarkEndpoint(
  method: string,
  path: string,
  iterations: number = 100,
  body?: object
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  let errors = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) errors++;
    } catch {
      errors++;
    } finally {
      latencies.push(performance.now() - start);
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    endpoint: `${method} ${path}`,
    iterations,
    errors,
    minMs: Math.min(...latencies),
    maxMs: Math.max(...latencies),
    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    p99Ms: sorted[Math.floor(sorted.length * 0.99)],
  };
}

function printResult(r: BenchmarkResult): void {
  console.log(`\n${r.endpoint}`);
  console.log(`  Iterations: ${r.iterations} | Errors: ${r.errors}`);
  console.log(`  Latency: min=${r.minMs.toFixed(2)}ms, mean=${r.meanMs.toFixed(2)}ms, max=${r.maxMs.toFixed(2)}ms`);
  console.log(`  Percentiles: p50=${r.p50Ms.toFixed(2)}ms, p95=${r.p95Ms.toFixed(2)}ms, p99=${r.p99Ms.toFixed(2)}ms`);
}

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log("LLM Gateway Performance Benchmarks");
  console.log("=".repeat(80));

  // Health check
  const health = await benchmarkEndpoint("GET", "/health");
  printResult(health);

  // Mock completion (no provider call)
  const completion = await benchmarkEndpoint("POST", "/v1/chat/completions", 50, {
    model: "mock",
    messages: [{ role: "user", content: "Hello" }],
  });
  printResult(completion);

  console.log("\n" + "=".repeat(80));
}

main().catch(console.error);
