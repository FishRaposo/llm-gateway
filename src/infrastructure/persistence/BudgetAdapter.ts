/** Budget adapter - implements BudgetPort using existing BudgetTracker.
 * Infrastructure layer - wraps external storage with domain interface.
 */

import type { BudgetPort } from "../../domain/ports/BudgetPort";
import { BudgetTracker } from "../../storage/budgetTracker";

export class BudgetAdapter implements BudgetPort {
  private tracker: BudgetTracker;

  constructor(redisUrl: string, globalLimitUsd: number) {
    this.tracker = new BudgetTracker(redisUrl, globalLimitUsd);
  }

  async getRemainingBudget(key: string): Promise<number> {
    return this.tracker.getRemainingBudget(key);
  }

  async deductBudget(key: string, amount: number): Promise<void> {
    await this.tracker.deductBudget(key, amount);
  }

  async setBudget(key: string, limit: number): Promise<void> {
    await this.tracker.setBudget(key, limit);
  }

  async getBudgetStatus(key: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
  }> {
    return this.tracker.getBudgetStatus(key);
  }

  async getGlobalSpend(): Promise<number> {
    return this.tracker.getGlobalSpend();
  }

  async close(): Promise<void> {
    await this.tracker.close();
  }
}
