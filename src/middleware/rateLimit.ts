/** Rate limiting middleware using Redis sliding windows. */

import type { GatewayConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { MiddlewareFunction } from "../proxy/handler";

const WINDOW_MS = 60000;
const DEFAULT_LIMIT = 60;

const inMemoryCounters = new Map<string, { count: number; windowStart: number }>();

export interface RateLimitConfig {
  limitRpm: number;
  windowMs: number;
}

const perKeyConfigs = new Map<string, RateLimitConfig>();

let redisClient: import("ioredis").Redis | null = null;
let redisUrl = "";

/**
 * Initializes the Redis client for distributed rate limiting.
 * @param url - Redis connection URL.
 */
export async function initRateLimitRedis(url: string): Promise<void> {
  redisUrl = url;
  try {
    const Redis = require("ioredis");
    const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    client.on("error", () => { /* suppress connection errors when Redis is unavailable */ });
    redisClient = client;
    await client.ping().catch(() => {
      redisClient = null;
      client.disconnect();
    });
  } catch {
    redisClient = null;
  }
}

/**
 * Sets a per-key rate limit configuration.
 * @param apiKey - The API key to configure.
 * @param config - Rate limit configuration.
 */
export function setKeyRateLimit(apiKey: string, config: RateLimitConfig): void {
  perKeyConfigs.set(apiKey, config);
}

/**
 * Gets the rate limit configuration for an API key.
 * @param apiKey - The API key to query.
 * @returns Rate limit configuration.
 */
export function getKeyRateLimitConfig(apiKey: string): RateLimitConfig {
  return perKeyConfigs.get(apiKey) ?? { limitRpm: DEFAULT_LIMIT, windowMs: WINDOW_MS };
}

/**
 * Creates a rate limiting middleware that enforces per-key request limits.
 * @param config - Gateway configuration.
 * @returns Middleware function.
 */
export function createRateLimitMiddleware(_config: GatewayConfig): MiddlewareFunction {
  return async (
    context: RequestContext,
    _config: GatewayConfig
  ): Promise<RequestContext | null> => {
    const keyConfig = getKeyRateLimitConfig(context.apiKey);
    const allowed = await checkRateLimit(context.apiKey, keyConfig.limitRpm, keyConfig.windowMs);

    if (!allowed) {
      const error = new Error("Rate limit exceeded") as Error & { statusCode: number; code: string };
      error.statusCode = 429;
      error.code = "rate_limit_exceeded";
      throw error;
    }

    return context;
  };
}

/**
 * Checks if an API key is within its rate limit using a sliding window.
 * Uses Redis for distributed counting, falls back to in-memory.
 * @param apiKey - The API key to check.
 * @param limit - Maximum requests per window.
 * @param windowMs - Window size in milliseconds.
 * @returns True if the request is allowed.
 */
export async function checkRateLimit(
  apiKey: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = WINDOW_MS
): Promise<boolean> {
  const now = Date.now();
  const key = `rate_limit:${apiKey}`;

  const client = redisClient;
  if (client) {
    try {
      const windowStart = now - windowMs;
      const results = (await client
        .multi()
        .zremrangebyscore(key, 0, windowStart)
        .zcard(key)
        .zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`)
        .expire(key, Math.ceil(windowMs / 1000) + 1)
        .exec()) as Array<[Error | null, unknown]>;

      if (results && results.length >= 2) {
        const count = results[1][1] as number;
        return count < limit;
      }
    } catch {
      // fall through to in-memory
    }
  }

  const counterKey = `rate_limit:${apiKey}`;
  let counter = inMemoryCounters.get(counterKey);

  if (!counter || now - counter.windowStart > windowMs) {
    counter = { count: 0, windowStart: now };
    inMemoryCounters.set(counterKey, counter);
  }

  counter.count++;
  return counter.count <= limit;
}

/**
 * Gets the current rate limit status for an API key.
 * @param apiKey - The API key to query.
 * @param limit - Maximum requests per window.
 * @param windowMs - Window size in milliseconds.
 * @returns Object with current count, limit, and remaining requests.
 */
export async function getRateLimitStatus(
  apiKey: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = WINDOW_MS
): Promise<{ count: number; limit: number; remaining: number; resetMs: number }> {
  const now = Date.now();
  const key = `rate_limit:${apiKey}`;

  const client = redisClient;
  if (client) {
    try {
      const windowStart = now - windowMs;
      await client.zremrangebyscore(key, 0, windowStart);
      const count = (await client.zcard(key)) as number;
      const oldest = await client.zrange(key, 0, 0, "WITHSCORES");
      let resetMs = windowMs;
      if (oldest && oldest.length >= 2) {
        const firstTs = parseInt(oldest[1], 10);
        resetMs = Math.max(0, windowMs - (now - firstTs));
      }
      return { count, limit, remaining: Math.max(0, limit - count), resetMs };
    } catch {
      // fall through to in-memory
    }
  }

  const counterKey = `rate_limit:${apiKey}`;
  const counter = inMemoryCounters.get(counterKey);

  if (!counter) {
    return { count: 0, limit, remaining: limit, resetMs: windowMs };
  }

  const elapsed = now - counter.windowStart;
  const resetMs = Math.max(0, windowMs - elapsed);
  const remaining = Math.max(0, limit - counter.count);

  return { count: counter.count, limit, remaining, resetMs };
}

/**
 * Resets rate limit counters. Useful for testing.
 */
export async function resetRateLimits(): Promise<void> {
  inMemoryCounters.clear();

  if (redisClient) {
    try {
      const keys = await redisClient.keys("rate_limit:*");
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Closes the Redis connection.
 */
export async function closeRateLimitRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
