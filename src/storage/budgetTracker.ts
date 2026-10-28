/** Budget tracking storage using Redis for real-time spend management.
 *
 * The lifecycle is reserve → settle | release, keyed by requestId so every
 * stage is idempotent and atomic under Redis (single Lua script per op) and
 * trivially atomic in the in-memory development backend.
 *
 * Budget record (Redis JSON + memory): { used, limit|null, period,
 * resetMonth, reserved: {requestId: amount} }. `limit: null` represents an
 * unlimited budget — JSON cannot encode Infinity, so null is the stored
 * sentinel and is interpreted as unbounded on read.
 */

const inMemoryBudgets = new Map<string, BudgetRecord>();
const inMemorySettled = new Set<string>();

interface BudgetRecord {
  used: number;
  limit: number | null;
  period?: string;
  resetMonth?: number;
  reserved?: Record<string, number>;
}

export interface ReserveResult {
  allowed: boolean;
  /** Remaining spend capacity after this reservation (Infinity when unbounded). */
  remaining: number;
  reason?: "reserved" | "already_reserved" | "exceeded";
}

/**
 * Lua: atomically apply monthly reset, then reserve `estimated` under
 * `requestId` iff already reserved (idempotent) or used+reserved+est <= limit.
 * KEYS[1] = budget key. ARGV = requestId, estimated, currentMonth, limitIsSet.
 * Returns [status, remaining]: status 0=reserved, 1=already_reserved, 2=exceeded.
 */
const RESERVE_LUA = `
local raw = redis.call('GET', KEYS[1])
local b = raw and cjson.decode(raw) or { used = 0, limit = cjson.null, reserved = {} }
local month = tonumber(ARGV[3])
if b.period == 'monthly' and b.resetMonth and b.resetMonth ~= month then
  b.used = 0
  b.resetMonth = month
  b.reserved = {}
end
b.reserved = b.reserved or {}
local reqId = ARGV[1]
local est = tonumber(ARGV[2])
local unbounded = (b.limit == cjson.null or b.limit == nil)
local function reservedTotal()
  local t = 0
  for _, v in pairs(b.reserved) do t = t + v end
  return t
end
if b.reserved[reqId] ~= nil then
  local rem = unbounded and 1e15 or math.max(0, b.limit - b.used - reservedTotal())
  return { 1, rem }
end
local capacity = unbounded and 1e15 or (b.limit - b.used - reservedTotal())
if est > capacity then
  return { 2, math.max(0, capacity) }
end
b.reserved[reqId] = est
redis.call('SET', KEYS[1], cjson.encode(b))
return { 0, unbounded and 1e15 or math.max(0, b.limit - b.used - reservedTotal()) }
`;

/**
 * Lua: idempotent settle. If the settle marker already exists, no-op.
 * Otherwise used += actual, drop the reservation, set a 24h marker.
 * KEYS[1] = budget key, KEYS[2] = settled marker key.
 * ARGV = requestId, actualCost, markerTtlSeconds.
 */
const SETTLE_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then return { 0 } end
local raw = redis.call('GET', KEYS[1])
local b = raw and cjson.decode(raw) or { used = 0, limit = cjson.null, reserved = {} }
local actual = tonumber(ARGV[2])
b.used = (b.used or 0) + actual
if b.reserved then b.reserved[ARGV[1]] = nil end
redis.call('SET', KEYS[1], cjson.encode(b))
redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[3]))
return { 1 }
`;

/**
 * Lua: idempotent release — removes the reservation if present.
 * KEYS[1] = budget key. ARGV = requestId.
 */
const RELEASE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return { 0 } end
local b = cjson.decode(raw)
if b.reserved and b.reserved[ARGV[1]] ~= nil then
  b.reserved[ARGV[1]] = nil
  redis.call('SET', KEYS[1], cjson.encode(b))
  return { 1 }
end
return { 0 }
`;

const SETTLE_MARKER_TTL_SECONDS = 86400;

// Reads may reset a monthly period, so that read/reset must share the same
// atomic boundary as reserve/settle. A GET followed by SET loses concurrent bills.
const READ_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local b = cjson.decode(raw)
local month = tonumber(ARGV[1])
if b.period == 'monthly' and b.resetMonth and b.resetMonth ~= month then
  b.used = 0
  b.resetMonth = month
  b.reserved = {}
  redis.call('SET', KEYS[1], cjson.encode(b))
end
return cjson.encode(b)
`;

export class BudgetTracker {
  private redisUrl: string;
  private client: import("ioredis").Redis | null = null;
  private clientFailed = false;
  /** Next timestamp at which a Redis retry is permitted (outage backoff). */
  private retryAt = 0;
  private connectPromise: Promise<import("ioredis").Redis | null> | null = null;
  private static readonly RETRY_BACKOFF_MS = 500;
  private globalLimitUsd: number;
  /**
   * When true, Redis is mandatory: reserve/settle/release reject instead of
   * silently degrading to process-local memory (which would diverge across
   * replicas). Strict connected-enforcement mode.
   */
  private requireRedis: boolean;

  /**
   * @param redisUrl - Redis connection URL.
   * @param globalLimitUsd - Global spend limit across all keys.
   * @param requireRedis - When true, fail closed if Redis is unavailable.
   */
  constructor(redisUrl: string, globalLimitUsd: number = Infinity, requireRedis = false) {
    this.redisUrl = redisUrl;
    this.globalLimitUsd = globalLimitUsd;
    this.requireRedis = requireRedis;
  }

  /**
   * Gets or creates the Redis client connection.
   * @returns Redis client instance, or null when unavailable in non-strict mode.
   */
  private async getClient(): Promise<import("ioredis").Redis | null> {
    if (this.client) return this.client;
    // Bounded retry: after a failure, wait out the backoff window instead of
    // paying a connect attempt on every operation, while still recovering
    // automatically when Redis returns.
    if (this.clientFailed && Date.now() < this.retryAt) return null;
    // Share one in-flight connect attempt across concurrent callers.
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.attemptConnect();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async attemptConnect(): Promise<import("ioredis").Redis | null> {
    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000, retryStrategy: () => null });
      client.on("error", () => { /* suppress connection errors when Redis is unavailable */ });
      try {
        await client.connect();
        await client.ping();
      } catch {
        client.disconnect();
        this.clientFailed = true;
        this.retryAt = Date.now() + BudgetTracker.RETRY_BACKOFF_MS;
        return null;
      }
      this.client = client;
      this.clientFailed = false;
      return this.client;
    } catch {
      this.clientFailed = true;
      this.retryAt = Date.now() + BudgetTracker.RETRY_BACKOFF_MS;
      return null;
    }
  }

  private currentMonth(): number {
    return new Date().getMonth();
  }

  private maybeResetBudget(budget: BudgetRecord): BudgetRecord {
    if (budget.period === "monthly" && budget.resetMonth !== undefined && budget.resetMonth !== this.currentMonth()) {
      budget.used = 0;
      budget.reserved = {};
      budget.resetMonth = this.currentMonth();
    }
    return budget;
  }

  private reservedTotal(budget: BudgetRecord): number {
    let total = 0;
    for (const key of Object.keys(budget.reserved ?? {})) total += budget.reserved![key];
    return total;
  }

  private assertBackend(redis: import("ioredis").Redis | null): asserts redis is NonNullable<typeof redis> | never {
    if (!redis && this.requireRedis) {
      throw new Error("Budget enforcement requires Redis (strict mode); backend unavailable");
    }
  }

  /**
   * Marks a live connection dead after an op-level failure. In non-strict
   * mode the caller falls through to the memory backend for this op; in
   * strict mode the error propagates (fail closed).
   */
  private markRedisFailed(): void {
    this.client?.disconnect();
    this.client = null;
    this.clientFailed = true;
    this.retryAt = Date.now() + BudgetTracker.RETRY_BACKOFF_MS;
  }

  /** Runs a Redis op, falling back on op failure when non-strict. */
  private async tryRedis<T>(op: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await op() };
    } catch (e) {
      if (this.requireRedis) throw e;
      this.markRedisFailed();
      return { ok: false };
    }
  }

  /**
   * Atomically reserves `estimatedCost` for `requestId` against the account
   * budget. Idempotent: a repeated call for the same requestId reports the
   * existing reservation rather than double-charging capacity.
   */
  async reserve(accountId: string, requestId: string, estimatedCost: number): Promise<ReserveResult> {
    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
      throw new RangeError("Reservation cost must be finite and nonnegative");
    }
    const redis = await this.getClient();
    this.assertBackend(redis);
    const budgetKey = `budget:${accountId}`;

    if (redis) {
      const r = await this.tryRedis(() =>
        redis.eval(RESERVE_LUA, 1, budgetKey, requestId, String(estimatedCost), String(this.currentMonth()), "1") as Promise<[number, number]>
      );
      if (r.ok) {
        const res = r.value;
        const remaining = res[1] >= 1e15 ? Infinity : res[1];
        return res[0] === 2
          ? { allowed: false, remaining, reason: "exceeded" }
          : { allowed: true, remaining, reason: res[0] === 1 ? "already_reserved" : "reserved" };
      }
    }

    const budget = this.maybeResetBudget(
      inMemoryBudgets.get(budgetKey) ?? { used: 0, limit: null, period: "monthly", resetMonth: this.currentMonth() }
    );
    budget.reserved ??= {};
    inMemoryBudgets.set(budgetKey, budget);
    if (budget.reserved[requestId] !== undefined) {
      const rem = budget.limit === null ? Infinity : Math.max(0, budget.limit - budget.used - this.reservedTotal(budget));
      return { allowed: true, remaining: rem, reason: "already_reserved" };
    }
    const capacity = budget.limit === null ? Infinity : budget.limit - budget.used - this.reservedTotal(budget);
    if (estimatedCost > capacity) {
      return { allowed: false, remaining: Math.max(0, capacity), reason: "exceeded" };
    }
    budget.reserved[requestId] = estimatedCost;
    return {
      allowed: true,
      remaining: budget.limit === null ? Infinity : Math.max(0, budget.limit - budget.used - this.reservedTotal(budget)),
      reason: "reserved",
    };
  }

  /**
   * Settles a reservation: charges `actualCost` to used spend and clears the
   * reservation. `actualCost === null` records an explicit unknown-usage
   * settlement — the reservation remains held pending measured reconciliation;
   * callers mark the audit trail accordingly. Idempotent per requestId:
   * replays are no-ops.
   */
  async settle(accountId: string, requestId: string, actualCost: number | null): Promise<void> {
    // An unknown bill is not a free request. Keep the reservation available
    // for explicit later reconciliation with measured usage.
    if (actualCost === null || !Number.isFinite(actualCost) || actualCost < 0) return;
    const redis = await this.getClient();
    this.assertBackend(redis);
    const budgetKey = `budget:${accountId}`;
    const actual = actualCost ?? 0;

    if (redis) {
      const markerKey = `budget_settled:${accountId}:${requestId}`;
      const r = await this.tryRedis(() =>
        redis.eval(SETTLE_LUA, 2, budgetKey, markerKey, requestId, String(actual), String(SETTLE_MARKER_TTL_SECONDS))
      );
      if (r.ok) return;
    }

    const marker = `${accountId}:${requestId}`;
    if (inMemorySettled.has(marker)) return;
    const budget = inMemoryBudgets.get(budgetKey);
    if (budget) {
      budget.used += actual;
      if (budget.reserved) delete budget.reserved[requestId];
      inMemoryBudgets.set(budgetKey, budget);
    }
    inMemorySettled.add(marker);
  }

  /**
   * Releases a reservation without charging (request rejected before provider
   * spend). Idempotent: releasing an absent reservation is a no-op.
   */
  async release(accountId: string, requestId: string): Promise<void> {
    const redis = await this.getClient();
    this.assertBackend(redis);
    const budgetKey = `budget:${accountId}`;

    if (redis) {
      const r = await this.tryRedis(() => redis.eval(RELEASE_LUA, 1, budgetKey, requestId));
      if (r.ok) return;
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (budget?.reserved && budget.reserved[requestId] !== undefined) {
      delete budget.reserved[requestId];
      inMemoryBudgets.set(budgetKey, budget);
    }
  }

  /**
   * Gets the remaining budget for an API key, accounting for in-flight
   * reservations so concurrent admissions cannot overspend.
   * @param key - API key identifier.
   * @returns Remaining budget in USD.
   */
  async getRemainingBudget(key: string): Promise<number> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.eval(READ_LUA, 1, budgetKey, String(this.currentMonth())) as string | null;
      if (!data) return Infinity;
      const budget = this.maybeResetBudget(JSON.parse(data) as BudgetRecord);
      budget.limit = budget.limit ?? null;
      if (budget.limit === null) return Infinity;
      return Math.max(0, budget.limit - budget.used - this.reservedTotal(budget));
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (!budget) return Infinity;
    this.maybeResetBudget(budget);
    if (budget.limit === null || budget.limit === Infinity) return Infinity;
    return Math.max(0, budget.limit - budget.used - this.reservedTotal(budget));
  }

  /**
   * Directly adds to an account's used spend. Retained for administrative and
   * migration paths; request flows use reserve/settle.
   * @param key - API key identifier.
   * @param amount - Amount to deduct in USD.
   */
  async deductBudget(key: string, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError("Deducted cost must be finite and nonnegative");
    }
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.get(budgetKey);
      const budget = data
        ? this.maybeResetBudget(JSON.parse(data) as BudgetRecord)
        : ({ used: 0, limit: null } as BudgetRecord);
      budget.used += amount;
      await redis.set(budgetKey, JSON.stringify(budget));
      return;
    }

    const budget = inMemoryBudgets.get(budgetKey) ?? { used: 0, limit: null, period: "monthly", resetMonth: this.currentMonth() };
    this.maybeResetBudget(budget);
    budget.used += amount;
    inMemoryBudgets.set(budgetKey, budget);
  }

  /**
   * Sets the budget limit for an API key.
   * @param key - API key identifier.
   * @param limit - Budget limit in USD (Infinity persists as the null sentinel).
   */
  async setBudget(key: string, limit: number): Promise<void> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;
    const storedLimit = Number.isFinite(limit) ? limit : null;

    if (redis) {
      const data = await redis.get(budgetKey);
      const existing = data ? (JSON.parse(data) as BudgetRecord) : ({ used: 0, limit: null } as BudgetRecord);
      existing.limit = storedLimit;
      await redis.set(budgetKey, JSON.stringify(existing));
      return;
    }

    const existing = inMemoryBudgets.get(budgetKey) ?? { used: 0, limit: null, period: "monthly", resetMonth: this.currentMonth() };
    existing.limit = storedLimit;
    inMemoryBudgets.set(budgetKey, existing);
  }

  /**
   * Gets the full budget status for an API key.
   * @param key - API key identifier.
   * @returns Budget status with used, reserved, limit, and remaining amounts.
   */
  async getBudgetStatus(key: string): Promise<{ used: number; limit: number; remaining: number; reserved?: number }> {
    const redis = await this.getClient();
    const budgetKey = `budget:${key}`;

    if (redis) {
      const data = await redis.eval(READ_LUA, 1, budgetKey, String(this.currentMonth())) as string | null;
      if (!data) return { used: 0, limit: Infinity, remaining: Infinity, reserved: 0 };
      const budget = this.maybeResetBudget(JSON.parse(data) as BudgetRecord);
      budget.limit = budget.limit ?? null;
      const reserved = this.reservedTotal(budget);
      const limit = budget.limit === null ? Infinity : budget.limit;
      return { used: budget.used, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - budget.used - reserved), reserved };
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (!budget) return { used: 0, limit: Infinity, remaining: Infinity, reserved: 0 };
    this.maybeResetBudget(budget);
    const reserved = this.reservedTotal(budget);
    const limit = budget.limit === null || budget.limit === Infinity ? Infinity : budget.limit;
    return { used: budget.used, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - budget.used - reserved), reserved };
  }

  /**
   * Gets the total spend (settled plus in-flight reservations) across all keys.
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
          const budget = JSON.parse(data) as BudgetRecord;
          total += budget.used + this.reservedTotal(budget);
        }
      }
      return total;
    }

    let total = 0;
    for (const [, budget] of inMemoryBudgets) {
      total += budget.used + this.reservedTotal(budget);
    }
    return total;
  }

  /**
   * Checks if a requested spend would exceed the global budget limit.
   * Note: advisory check only — per-account reserve is the authoritative gate.
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
      const limit = data ? (JSON.parse(data) as BudgetRecord).limit : null;
      await redis.set(budgetKey, JSON.stringify({ used: 0, limit }));
      return;
    }

    const budget = inMemoryBudgets.get(budgetKey);
    if (budget) {
      budget.used = 0;
      budget.reserved = {};
    }
  }

  /**
   * Clears all in-memory budget state. Test support only.
   */
  static resetInMemoryState(): void {
    inMemoryBudgets.clear();
    inMemorySettled.clear();
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
