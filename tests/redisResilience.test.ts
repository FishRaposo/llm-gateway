/** Redis outage/recovery behavior via a controllable fake ioredis. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = {
  ping: vi.fn<() => Promise<string>>(),
  eval: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  disconnect: vi.fn(),
  quit: vi.fn().mockResolvedValue("OK"),
  on: vi.fn(),
};

vi.mock("ioredis", () => ({ default: vi.fn(function () { return fake; }) }));

import { BudgetTracker } from "../src/storage/budgetTracker";

describe("Redis outage and recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    BudgetTracker.resetInMemoryState();
  });

  it("non-strict mode serves requests from memory while Redis is down", async () => {
    fake.ping.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const tracker = new BudgetTracker("redis://fake:6379");
    await tracker.setBudget("acct", 10);
    const r = await tracker.reserve("acct", "req-1", 5);
    expect(r.allowed).toBe(true);
    await tracker.settle("acct", "req-1", 2);
    const status = await tracker.getBudgetStatus("acct");
    expect(status.used).toBe(2);
  });

  it("strict mode fails closed when Redis is unavailable", async () => {
    fake.ping.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const tracker = new BudgetTracker("redis://fake:6379", Infinity, true);
    await expect(tracker.reserve("acct", "req-1", 5)).rejects.toThrow(/strict/i);
  });

  it("uses Redis atomics when the backend is healthy", async () => {
    fake.ping.mockResolvedValue("PONG");
    fake.eval.mockResolvedValue([0, 9.5]);
    const tracker = new BudgetTracker("redis://fake:6379");
    const r = await tracker.reserve("acct", "req-1", 0.5);
    expect(r.allowed).toBe(true);
    expect(fake.eval).toHaveBeenCalled();
    // The reserve ran through the Lua script, not the memory map.
    expect(r.remaining).toBe(9.5);
  });

  it("op-level Redis failure marks the connection dead and falls back (non-strict)", async () => {
    fake.ping.mockResolvedValue("PONG");
    fake.eval
      .mockRejectedValueOnce(new Error("READONLY replica"))
      .mockResolvedValue([0, 9]);
    const tracker = new BudgetTracker("redis://fake:6379");
    const r1 = await tracker.reserve("acct", "req-1", 0.5);
    expect(r1.allowed).toBe(true); // served by memory after op failure
    expect(r1.reason).toBe("reserved");
  });

  it("reconnects automatically after the backoff window", async () => {
    fake.ping
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("PONG");
    fake.eval.mockResolvedValue([0, 9]);
    const tracker = new BudgetTracker("redis://fake:6379");
    await tracker.reserve("acct", "req-down", 1); // fails over to memory
    // Wait out the retry backoff, then the next op should attempt Redis again.
    await new Promise((r) => setTimeout(r, 600));
    fake.eval.mockClear();
    await tracker.reserve("acct", "req-up", 1);
    expect(fake.eval).toHaveBeenCalled();
  });
});
