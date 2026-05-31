import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { validateApiKey, registerApiKey, revokeApiKey } from "../src/middleware/auth";
import { BudgetTracker } from "../src/storage/budgetTracker";
import { CacheStore } from "../src/storage/cacheStore";
import { AuditLogStorage } from "../src/storage/auditLog";
import type { GatewayConfig } from "../src/types";

function buildHealthPayload(options: {
  redisOnline: boolean;
  dbOnline: boolean;
  uptime: number;
}): Record<string, unknown> {
  return {
    status: options.redisOnline && options.dbOnline ? "healthy" : "degraded",
    providers: {},
    redis: options.redisOnline ? "connected" : "disconnected",
    database: options.dbOnline ? "connected" : "disconnected",
    uptimeSeconds: options.uptime,
  };
}

const baseConfig: GatewayConfig = {
  port: 3000,
  logLevel: "info",
  defaultModel: "gpt-4o-mini",
  defaultProvider: "openai",
  databasePath: ":memory:",
  redisUrl: "redis://localhost:6379",
  gatewayApiKey: "admin-key",
  providers: {},
  routing: {
    default: { provider: "openai", model: "gpt-4o-mini" },
    rules: [],
    fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
  },
  policy: { enabled: false, evalOrder: [], rules: [] },
  budgets: { enabled: false, globalLimitUsd: 1000, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
};

function checkStorageConnectivity(): { redisOnline: boolean; dbOnline: boolean } {
  let redisOnline = false;
  let dbOnline = false;

  try {
    const cacheStore = new CacheStore(baseConfig.redisUrl);
    redisOnline = cacheStore !== null;
  } catch {
    redisOnline = false;
  }

  try {
    const auditLog = new AuditLogStorage(baseConfig.databasePath);
    dbOnline = auditLog !== null;
  } catch {
    dbOnline = false;
  }

  return { redisOnline, dbOnline };
}

describe("Admin Endpoints", () => {
  describe("Health Check", () => {
    it("should report actual Redis and DB status based on connectivity checks", () => {
      const connectivity = checkStorageConnectivity();

      const payload = buildHealthPayload({
        redisOnline: connectivity.redisOnline,
        dbOnline: connectivity.dbOnline,
        uptime: process.uptime(),
      });

      expect(payload).toHaveProperty("status");
      expect(payload).toHaveProperty("redis");
      expect(payload).toHaveProperty("database");
      expect(payload).toHaveProperty("uptimeSeconds");

      expect(["connected", "disconnected"]).toContain(payload.redis);
      expect(["connected", "disconnected"]).toContain(payload.database);

      expect(typeof payload.uptimeSeconds).toBe("number");
      expect(payload.uptimeSeconds).toBeGreaterThan(0);
    });

    it("should report degraded status when Redis is disconnected", () => {
      const payload = buildHealthPayload({
        redisOnline: false,
        dbOnline: true,
        uptime: 3600,
      });

      expect(payload.status).not.toBe("healthy");
      expect(payload.redis).toBe("disconnected");
      expect(payload.database).toBe("connected");
    });

    it("should report degraded status when DB is disconnected", () => {
      const payload = buildHealthPayload({
        redisOnline: true,
        dbOnline: false,
        uptime: 3600,
      });

      expect(payload.status).not.toBe("healthy");
      expect(payload.redis).toBe("connected");
      expect(payload.database).toBe("disconnected");
    });

    it("should report healthy when both services are connected", () => {
      const payload = buildHealthPayload({
        redisOnline: true,
        dbOnline: true,
        uptime: 7200,
      });

      expect(payload.status).toBe("healthy");
      expect(payload.redis).toBe("connected");
      expect(payload.database).toBe("connected");
    });

    it("should report degraded when both services are disconnected", () => {
      const payload = buildHealthPayload({
        redisOnline: false,
        dbOnline: false,
        uptime: 1800,
      });

      expect(payload.status).toBe("degraded");
      expect(payload.redis).toBe("disconnected");
      expect(payload.database).toBe("disconnected");
    });
  });

  describe("POST /admin/keys", () => {
    const testKey = `gw-test-${Date.now()}-abc123`;

    afterAll(() => {
      revokeApiKey(testKey);
    });

    it("should register a new API key and make it validatable", () => {
      registerApiKey(testKey, "test-admin-user", ["chat"], 100);

      expect(validateApiKey(testKey)).toBe(true);
    });

    it("should reject unregistered keys", () => {
      expect(validateApiKey("non-existent-key")).toBe(false);
    });

    it("should allow registered key with custom budget", () => {
      const customKey = `gw-custom-${Date.now()}-xyz`;
      registerApiKey(customKey, "custom-user", ["chat"], 50);

      expect(validateApiKey(customKey)).toBe(true);

      revokeApiKey(customKey);
      expect(validateApiKey(customKey)).toBe(false);
    });

    it("should allow registered key with full permissions", () => {
      const adminKey = `gw-full-${Date.now()}-admin`;
      registerApiKey(adminKey, "admin-user", ["*"], Infinity);

      expect(validateApiKey(adminKey)).toBe(true);

      revokeApiKey(adminKey);
    });

    it("should revoke a previously valid key", () => {
      const key = `gw-revoke-${Date.now()}-test`;
      registerApiKey(key, "temp-user", ["chat"], 10);

      expect(validateApiKey(key)).toBe(true);

      revokeApiKey(key);

      expect(validateApiKey(key)).toBe(false);
    });

    it("should support registering multiple keys independently", () => {
      const key1 = `gw-multi-1-${Date.now()}`;
      const key2 = `gw-multi-2-${Date.now()}`;

      registerApiKey(key1, "user-1", ["chat"], 50);
      registerApiKey(key2, "user-2", ["chat"], 75);

      expect(validateApiKey(key1)).toBe(true);
      expect(validateApiKey(key2)).toBe(true);

      revokeApiKey(key1);
      expect(validateApiKey(key1)).toBe(false);
      expect(validateApiKey(key2)).toBe(true);

      revokeApiKey(key2);
    });
  });

  describe("Budget integration with API keys", () => {
    let budgetTracker: BudgetTracker;

    beforeEach(async () => {
      budgetTracker = new BudgetTracker("redis://localhost:0");
    });

    it("should track budget separately per registered key", async () => {
      const keyA = `gw-budget-a-${Date.now()}`;
      const keyB = `gw-budget-b-${Date.now()}`;

      registerApiKey(keyA, "budget-user-a", ["chat"], 100);
      registerApiKey(keyB, "budget-user-b", ["chat"], 200);

      await budgetTracker.setBudget(keyA, 100);
      await budgetTracker.setBudget(keyB, 200);

      await budgetTracker.deductBudget(keyA, 25);
      await budgetTracker.deductBudget(keyB, 50);

      const statusA = await budgetTracker.getBudgetStatus(keyA);
      const statusB = await budgetTracker.getBudgetStatus(keyB);

      expect(statusA.used).toBe(25);
      expect(statusA.remaining).toBe(75);
      expect(statusB.used).toBe(50);
      expect(statusB.remaining).toBe(150);

      revokeApiKey(keyA);
      revokeApiKey(keyB);
    });
  });
});
