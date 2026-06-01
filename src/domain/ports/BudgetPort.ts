/** Budget port - interface for budget tracking.
 * Domain defines the contract, infrastructure implements it.
 */

export interface BudgetPort {
  getRemainingBudget(key: string): Promise<number>;

  deductBudget(key: string, amount: number): Promise<void>;

  setBudget(key: string, limit: number): Promise<void>;

  getBudgetStatus(key: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
  }>;

  getGlobalSpend(): Promise<number>;

  close(): Promise<void>;
}
