/** Budget tracking storage using Redis for real-time spend management. */

const inMemoryBudgets = new Map<string, { used: number; limit: number; period: string; resetMonth: number }>();

export class BudgetTracker {
  private redisUrl: string;
  private client: import("ioredis").Redis | null = null;
  private globalLimitUsd: number;

  /**
   * @param redisUrl - Redis connection URL.
   * @param globalLimitUsd - Global spend limit across all keys.
   */
  constructor(redisUrl: string, globalLimitUsd: number = Infinity) {
    this.redisUrl = redisUrl;
    this.globalLimitUsd = globalLimitUsd;
  }

  /**
   * Gets or creates the Redis client connection.
   * @returns Redis client instance.
   */
  private async getClient(): Promise<import("ioredis").Redis | null> {
    if (this.client) return this.client;

    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      client.on("error", () => { /* suppress connection errors when Redis is unavailable */ });
      this.client = client;
      await client.ping().catch(() => {
        this.client = null;
        client.disconnect();
        return null;
      });
      return this.client;
    } catch {
      return null;
    }
  }

  private currentMonth(): number {
    return new Date().getMonth();
  }

  private maybeResetBudget(budget: { used: number; limit: number; period?: string; resetMonth?: number }): { used: number; limit: number } {
    if (budget.period === "monthly" && budget.resetMonth !== undefined && budget.resetMonth !== this.currentMonth()) {
      budget.used = 0;
      budget.resetMonth = this.currentMonth();
    }
    return budget;
  }

  /**
   * Gets the remaining budget for an API key.
   * @param key - API key identifier.
   * @returns Remaining budget in USD.
   */
  async getRemainingBudget(key: string): Promise<number> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.get(budgetKey);
      if (!data) return Infinity;
      const budget = this.maybeResetBudget(JSON.parse(data) as { used: number; limit: number; period?: string; resetMonth?: number });
      await redis.set(budgetKey, JSON.stringify(budget));
      return Math.max(0, budget.limit - budget.used);
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (!budget) return Infinity;
    this.maybeResetBudget(budget);
    return Math.max(0, budget.limit - budget.used);
  }

  /**
   * Deducts an amount from an API key's budget.
   * @param key - API key identifier.
   * @param amount - Amount to deduct in USD.
   */
  async deductBudget(key: string, amount: number): Promise<void> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.get(budgetKey);
      const budget = data
        ? this.maybeResetBudget(JSON.parse(data) as { used: number; limit: number; period?: string; resetMonth?: number })
        : { used: 0, limit: Infinity };
      budget.used += amount;
      await redis.set(budgetKey, JSON.stringify(budget));
      return;
    }

    const budget = inMemoryBudgets.get(budgetKey) ?? { used: 0, limit: Infinity, period: "monthly", resetMonth: this.currentMonth() };
    this.maybeResetBudget(budget);
    budget.used += amount;
    inMemoryBudgets.set(budgetKey, budget);
  }

  /**
   * Sets the budget limit for an API key.
   * @param key - API key identifier.
   * @param limit - Budget limit in USD.
   */
  async setBudget(key: string, limit: number): Promise<void> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.get(budgetKey);
      const existing = data ? (JSON.parse(data) as { used: number; limit: number; period?: string; resetMonth?: number }) : { used: 0, limit };
      existing.limit = limit;
      await redis.set(budgetKey, JSON.stringify(existing));
      return;
    }

    const existing = inMemoryBudgets.get(budgetKey) ?? { used: 0, limit, period: "monthly", resetMonth: this.currentMonth() };
    existing.limit = limit;
    inMemoryBudgets.set(budgetKey, existing);
  }

  /**
   * Gets the full budget status for an API key.
   * @param key - API key identifier.
   * @returns Budget status with used, limit, and remaining amounts.
   */
  async getBudgetStatus(key: string): Promise<{ used: number; limit: number; remaining: number }> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.get(budgetKey);
      if (!data) return { used: 0, limit: Infinity, remaining: Infinity };
      const budget = this.maybeResetBudget(JSON.parse(data) as { used: number; limit: number; period?: string; resetMonth?: number });
      await redis.set(budgetKey, JSON.stringify(budget));
      return { used: budget.used, limit: budget.limit, remaining: Math.max(0, budget.limit - budget.used) };
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (!budget) return { used: 0, limit: Infinity, remaining: Infinity };
    this.maybeResetBudget(budget);
    return { used: budget.used, limit: budget.limit, remaining: Math.max(0, budget.limit - budget.used) };
  }

  /**
   * Gets the total spend across all API keys.
   * @returns Total global spend in USD.
   */
  async getGlobalSpend(): Promise<number> {
    const redis = await this.getClient();

    if (redis) {
      const keys = await redis.keys("budget:*");
      let total = 0;
      for (const k of keys) {
        const data = await redis.get(k);
        if (data) {
          const budget = JSON.parse(data) as { used: number; limit: number };
          total += budget.used;
        }
      }
      return total;
    }

    let total = 0;
    for (const [, budget] of inMemoryBudgets) {
      total += budget.used;
    }
    return total;
  }

  /**
   * Checks if a requested spend would exceed the global budget limit.
   * @param requestedCost - The cost to check against the global limit.
   * @returns True if the spend is within the global limit.
   */
  async checkGlobalBudget(requestedCost: number): Promise<boolean> {
    const currentSpend = await this.getGlobalSpend();
    return currentSpend + requestedCost <= this.globalLimitUsd;
  }

  /**
   * Resets the budget for an API key (e.g., at period boundary).
   * @param key - API key identifier.
   */
  async resetBudget(key: string): Promise<void> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.get(budgetKey);
      const limit = data ? (JSON.parse(data) as { used: number; limit: number }).limit : Infinity;
      await redis.set(budgetKey, JSON.stringify({ used: 0, limit }));
      return;
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (budget) {
      budget.used = 0;
    }
  }

  /**
   * Closes the Redis connection.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
