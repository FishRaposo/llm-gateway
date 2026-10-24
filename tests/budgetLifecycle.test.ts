/** Budget reserve/settle/release lifecycle — in-memory backend (portable profile). */
import { describe, it, expect, beforeEach } from "vitest";
import { BudgetTracker } from "../src/storage/budgetTracker";

const NO_REDIS = "redis://localhost:0";

describe("Budget lifecycle (in-memory backend)", () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    BudgetTracker.resetInMemoryState();
    tracker = new BudgetTracker(NO_REDIS);
  });

  it("admission is atomic: concurrent reserves cannot overspend a shared limit", async () => {
    await tracker.setBudget("acct", 10);
    // 20 concurrent reservations of $1 each against a $10 limit.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => tracker.reserve("acct", `req-${i}`, 1))
    );
    const allowed = results.filter((r) => r.allowed);
    expect(allowed).toHaveLength(10);
    const status = await tracker.getBudgetStatus("acct");
    expect(status.reserved).toBe(10);
    expect(status.used).toBe(0);
    // Capacity is fully reserved — no further admission.
    const extra = await tracker.reserve("acct", "req-overflow", 1);
    expect(extra.allowed).toBe(false);
    expect(extra.reason).toBe("exceeded");
  });

  it("settle charges actual cost once; replaying the same requestId is a no-op", async () => {
    await tracker.setBudget("acct", 10);
    await tracker.reserve("acct", "req-1", 1);

    await tracker.settle("acct", "req-1", 0.35);
    let status = await tracker.getBudgetStatus("acct");
    expect(status.used).toBeCloseTo(0.35, 12);
    expect(status.reserved).toBe(0);

    // Duplicate settlement (client retry / redelivery) must not double-charge.
    await tracker.settle("acct", "req-1", 0.35);
    status = await tracker.getBudgetStatus("acct");
    expect(status.used).toBeCloseTo(0.35, 12);
  });

  it("reserve is idempotent: a replayed requestId reports the held reservation", async () => {
    await tracker.setBudget("acct", 10);
    const first = await tracker.reserve("acct", "req-dup", 2);
    const second = await tracker.reserve("acct", "req-dup", 2);
    expect(first.reason).toBe("reserved");
    expect(second.allowed).toBe(true);
    expect(second.reason).toBe("already_reserved");
    // Only $2 reserved, not $4.
    const status = await tracker.getBudgetStatus("acct");
    expect(status.reserved).toBe(2);
  });

  it("release frees reserved capacity without charging", async () => {
    await tracker.setBudget("acct", 5);
    await tracker.reserve("acct", "req-r", 4);
    await tracker.release("acct", "req-r");
    const status = await tracker.getBudgetStatus("acct");
    expect(status.reserved).toBe(0);
    expect(status.used).toBe(0);
    // Releasing an absent reservation is a safe no-op.
    await tracker.release("acct", "req-r");
    // Capacity is available again.
    const again = await tracker.reserve("acct", "req-r2", 4);
    expect(again.allowed).toBe(true);
  });

  it("unknown usage settles explicitly: reservation released, no fabricated charge", async () => {
    await tracker.setBudget("acct", 10);
    await tracker.reserve("acct", "req-u", 3);
    await tracker.settle("acct", "req-u", null);
    const status = await tracker.getBudgetStatus("acct");
    expect(status.reserved).toBe(0);
    expect(status.used).toBe(0); // explicit zero — not an invented estimate
  });

  it("accounts are isolated: one account's spend cannot consume another's limit", async () => {
    await tracker.setBudget("acct-a", 2);
    await tracker.setBudget("acct-b", 100);
    await tracker.reserve("acct-a", "req-a", 2);
    const bSees = await tracker.reserve("acct-b", "req-b", 50);
    expect(bSees.allowed).toBe(true);
    const aAgain = await tracker.reserve("acct-a", "req-a2", 1);
    expect(aAgain.allowed).toBe(false);
  });

  it("unlimited accounts stay unlimited under reserve/settle", async () => {
    // No setBudget — default unbounded identity.
    const r = await tracker.reserve("acct-free", "req-f", 500);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(Infinity);
    await tracker.settle("acct-free", "req-f", 500);
    const status = await tracker.getBudgetStatus("acct-free");
    expect(status.remaining).toBe(Infinity);
    expect(status.used).toBe(500);
  });

  it("partial reservation capacity is honored precisely at the boundary", async () => {
    await tracker.setBudget("acct", 10);
    await tracker.reserve("acct", "a", 6);
    await tracker.settle("acct", "a", 6); // used=6, reserved=0
    const exact = await tracker.reserve("acct", "b", 4);
    expect(exact.allowed).toBe(true);
    const over = await tracker.reserve("acct", "c", 0.01);
    expect(over.allowed).toBe(false);
  });
});
