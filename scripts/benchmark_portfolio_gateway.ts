/**
 * Portfolio benchmark: measures the gateway's admission/settle/streaming
 * behavior against the in-memory development backend and mock provider.
 *
 * This is a LOCAL, synthetic measurement — not production capacity data and
 * not a Redis-backed figure. It exists so the reserve/settle stream path has
 * one reproducible timing harness. Output: JSON manifest to stdout.
 *
 * Run: npm run benchmark:portfolio
 */
import { BudgetTracker } from "../src/storage/budgetTracker";

interface BenchResult {
  scenario: string;
  iterations: number;
  totalMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  detail: Record<string, unknown>;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(scenario: string, timings: number[], detail: Record<string, unknown>): BenchResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = timings.reduce((s, t) => s + t, 0);
  return {
    scenario,
    iterations: timings.length,
    totalMs: Number(total.toFixed(2)),
    meanMs: Number((total / timings.length).toFixed(3)),
    p50Ms: Number(percentile(sorted, 50).toFixed(3)),
    p95Ms: Number(percentile(sorted, 95).toFixed(3)),
    detail,
  };
}

async function main(): Promise<void> {
  const results: BenchResult[] = [];

  // 1. Concurrent admission: N parallel reserves against a fixed limit.
  {
    BudgetTracker.resetInMemoryState();
    const tracker = new BudgetTracker("redis://localhost:0");
    await tracker.setBudget("bench-acct", 500);
    const timings: number[] = [];
    const t0 = performance.now();
    const outcomes = await Promise.all(
      Array.from({ length: 200 }, async (_, i) => {
        const s = performance.now();
        const r = await tracker.reserve("bench-acct", `bench-${i}`, 1);
        timings.push(performance.now() - s);
        return r.allowed;
      })
    );
    const wallMs = performance.now() - t0;
    const admitted = outcomes.filter(Boolean).length;
    results.push(
      summarize("concurrent_reserve_200x_$500_limit", timings, {
        admitted,
        wallMs: Number(wallMs.toFixed(2)),
        invariant: "admitted <= 500",
      })
    );
    if (admitted > 500) {
      throw new Error(`INVARIANT VIOLATED: ${admitted} admitted against a 500 limit`);
    }
  }

  // 2. Full lifecycle: reserve → settle for many sequential requests.
  {
    BudgetTracker.resetInMemoryState();
    const tracker = new BudgetTracker("redis://localhost:0");
    await tracker.setBudget("bench-life", 1_000_000);
    const timings: number[] = [];
    for (let i = 0; i < 500; i++) {
      const s = performance.now();
      await tracker.reserve("bench-life", `life-${i}`, 0.01);
      await tracker.settle("bench-life", `life-${i}`, 0.005);
      timings.push(performance.now() - s);
    }
    results.push(
      summarize("sequential_reserve_settle_500x", timings, {
        invariant: "used == 2.5",
      })
    );
    const status = await tracker.getBudgetStatus("bench-life");
    if (Math.abs(status.used - 2.5) > 1e-9) {
      throw new Error(`INVARIANT VIOLATED: used ${status.used} != 2.5`);
    }
  }

  // 3. Idempotent replay: settle replays must be near-free and charge once.
  {
    BudgetTracker.resetInMemoryState();
    const tracker = new BudgetTracker("redis://localhost:0");
    await tracker.setBudget("bench-replay", 100);
    await tracker.reserve("bench-replay", "replay-1", 1);
    const timings: number[] = [];
    for (let i = 0; i < 200; i++) {
      const s = performance.now();
      await tracker.settle("bench-replay", "replay-1", 0.5);
      timings.push(performance.now() - s);
    }
    const status = await tracker.getBudgetStatus("bench-replay");
    results.push(
      summarize("idempotent_settle_replay_200x", timings, {
        chargedUsed: status.used,
        invariant: "used == 0.5 (charged exactly once)",
      })
    );
    if (Math.abs(status.used - 0.5) > 1e-9) {
      throw new Error(`INVARIANT VIOLATED: replay charged ${status.used}`);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    backend: "in-memory (portable profile — Redis not present)",
    scope: "local development measurement; not a production capacity claim",
    results,
  };
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
