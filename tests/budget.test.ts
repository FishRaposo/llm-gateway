import { describe, it, expect, beforeEach } from "vitest";
import { BudgetTracker } from "../src/storage/budgetTracker";

describe("Budget Tracker", () => {
  let budgetTracker: BudgetTracker;

  beforeEach(async () => {
    budgetTracker = new BudgetTracker("redis://localhost:0");
  });

  it("should return Infinity when no budget is set", async () => {
    const remaining = await budgetTracker.getRemainingBudget("unknown-key");
    expect(remaining).toBe(Infinity);
  });

  it("should set and track budget limits", async () => {
    await budgetTracker.setBudget("test-key", 100);
    const status = await budgetTracker.getBudgetStatus("test-key");
    expect(status.limit).toBe(100);
    expect(status.used).toBe(0);
    expect(status.remaining).toBe(100);
  });

  it("should deduct from budget", async () => {
    await budgetTracker.setBudget("deduct-key", 50);
    await budgetTracker.deductBudget("deduct-key", 10);
    const status = await budgetTracker.getBudgetStatus("deduct-key");
    expect(status.used).toBe(10);
    expect(status.remaining).toBe(40);
  });

  it("should report remaining budget accurately", async () => {
    await budgetTracker.setBudget("remaining-key", 25);
    await budgetTracker.deductBudget("remaining-key", 20);
    const remaining = await budgetTracker.getRemainingBudget("remaining-key");
    expect(remaining).toBe(5);
  });

  it("should reset budget usage while keeping limit", async () => {
    await budgetTracker.setBudget("reset-key", 100);
    await budgetTracker.deductBudget("reset-key", 75);
    await budgetTracker.resetBudget("reset-key");
    const status = await budgetTracker.getBudgetStatus("reset-key");
    expect(status.used).toBe(0);
    expect(status.limit).toBe(100);
  });

  it("should not go below zero remaining", async () => {
    await budgetTracker.setBudget("zero-key", 10);
    await budgetTracker.deductBudget("zero-key", 15);
    const remaining = await budgetTracker.getRemainingBudget("zero-key");
    expect(remaining).toBe(0);
  });
});
