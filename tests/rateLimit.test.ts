import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  getRateLimitStatus,
  setKeyRateLimit,
  getKeyRateLimitConfig,
  createRateLimitMiddleware,
  resetRateLimits,
} from "../src/middleware/rateLimit";
import type { GatewayConfig } from "../src/types";
import type { RequestContext } from "../src/types/routing";

const config = {} as GatewayConfig;

function makeContext(apiKey: string): RequestContext {
  return {
    requestId: "req-1",
    apiKey,
    apiKeyName: "test",
    permissions: [],
    originalModel: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    metadata: {},
    timestamp: new Date().toISOString(),
  };
}

describe("Rate limiting middleware (in-memory fallback)", () => {
  beforeEach(async () => {
    await resetRateLimits();
  });

  it("allows requests under the limit and blocks once exceeded", async () => {
    const key = "key-under-limit";
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit(key, 3, 60000)).toBe(true);
    }
    // 4th request in the window exceeds the limit of 3.
    expect(await checkRateLimit(key, 3, 60000)).toBe(false);
  });

  it("tracks each api key independently", async () => {
    expect(await checkRateLimit("key-a", 1, 60000)).toBe(true);
    expect(await checkRateLimit("key-a", 1, 60000)).toBe(false);
    // Different key has its own fresh window.
    expect(await checkRateLimit("key-b", 1, 60000)).toBe(true);
  });

  it("resets counters via resetRateLimits", async () => {
    expect(await checkRateLimit("key-reset", 1, 60000)).toBe(true);
    expect(await checkRateLimit("key-reset", 1, 60000)).toBe(false);
    await resetRateLimits();
    expect(await checkRateLimit("key-reset", 1, 60000)).toBe(true);
  });

  it("reports status with count, limit, and remaining", async () => {
    const key = "key-status";
    await checkRateLimit(key, 5, 60000);
    await checkRateLimit(key, 5, 60000);
    const status = await getRateLimitStatus(key, 5, 60000);
    expect(status.count).toBe(2);
    expect(status.limit).toBe(5);
    expect(status.remaining).toBe(3);
    expect(status.resetMs).toBeGreaterThan(0);
  });

  it("reports a full window for a key that has never been seen", async () => {
    const status = await getRateLimitStatus("never-seen-key", 10, 60000);
    expect(status).toEqual({ count: 0, limit: 10, remaining: 10, resetMs: 60000 });
  });
});

describe("Per-key rate limit configuration", () => {
  it("returns defaults when no per-key config is set", () => {
    expect(getKeyRateLimitConfig("unconfigured-key")).toEqual({
      limitRpm: 60,
      windowMs: 60000,
    });
  });

  it("returns the configured limit after setKeyRateLimit", () => {
    setKeyRateLimit("vip-key", { limitRpm: 600, windowMs: 30000 });
    expect(getKeyRateLimitConfig("vip-key")).toEqual({
      limitRpm: 600,
      windowMs: 30000,
    });
  });
});

describe("createRateLimitMiddleware", () => {
  beforeEach(async () => {
    await resetRateLimits();
  });

  it("passes the context through when under the limit", async () => {
    setKeyRateLimit("mw-key", { limitRpm: 2, windowMs: 60000 });
    const mw = createRateLimitMiddleware(config);
    const ctx = makeContext("mw-key");
    const result = await mw(ctx, config);
    expect(result).toBe(ctx);
  });

  it("throws a 429 error once the limit is exceeded", async () => {
    setKeyRateLimit("mw-block", { limitRpm: 1, windowMs: 60000 });
    const mw = createRateLimitMiddleware(config);
    const ctx = makeContext("mw-block");
    await mw(ctx, config); // consume the single allowed request
    await expect(mw(ctx, config)).rejects.toMatchObject({
      statusCode: 429,
      code: "rate_limit_exceeded",
    });
  });
});
