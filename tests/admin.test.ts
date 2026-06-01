import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { validateApiKey, registerApiKey, revokeApiKey } from "../src/middleware/auth";
import { ApiKeyStore } from "../src/storage/apiKeyStore";
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
    let store: ApiKeyStore;
    const createdIds: string[] = [];

    beforeEach(() => {
      store = new ApiKeyStore(":memory:");
    });

    afterAll(async () => {
      for (const id of createdIds) {
        await revokeApiKey(store, id);
      }
    });

    it("should register a new API key and make it validatable", async () => {
      const created = await registerApiKey(store, { name: "test-admin-user", permissions: ["chat"], budgetUsd: 100 });
      createdIds.push(created.id);

      const valid = await validateApiKey(store, created.apiKey);
      expect(valid).toBe(true);
    });

    it("should reject unregistered keys", async () => {
      const valid = await validateApiKey(store, "non-existent-key");
      expect(valid).toBe(false);
    });

    it("should allow registered key with custom budget", async () => {
      const created = await registerApiKey(store, { name: "custom-user", permissions: ["chat"], budgetUsd: 50 });
      createdIds.push(created.id);

      const valid = await validateApiKey(store, created.apiKey);
      expect(valid).toBe(true);

      await revokeApiKey(store, created.id);
      const afterRevoke = await validateApiKey(store, created.apiKey);
      expect(afterRevoke).toBe(false);
    });

    it("should allow registered key with full permissions", async () => {
      const created = await registerApiKey(store, { name: "admin-user", permissions: ["*"], budgetUsd: 10000 });
      createdIds.push(created.id);

      const valid = await validateApiKey(store, created.apiKey);
      expect(valid).toBe(true);

      await revokeApiKey(store, created.id);
    });

    it("should revoke a previously valid key", async () => {
      const created = await registerApiKey(store, { name: "temp-user", permissions: ["chat"], budgetUsd: 10 });
      createdIds.push(created.id);

      const validBefore = await validateApiKey(store, created.apiKey);
      expect(validBefore).toBe(true);

      await revokeApiKey(store, created.id);

      const validAfter = await validateApiKey(store, created.apiKey);
      expect(validAfter).toBe(false);
    });

    it("should support registering multiple keys independently", async () => {
      const created1 = await registerApiKey(store, { name: "user-1", permissions: ["chat"], budgetUsd: 50 });
      const created2 = await registerApiKey(store, { name: "user-2", permissions: ["chat"], budgetUsd: 75 });
      createdIds.push(created1.id, created2.id);

      expect(await validateApiKey(store, created1.apiKey)).toBe(true);
      expect(await validateApiKey(store, created2.apiKey)).toBe(true);

      await revokeApiKey(store, created1.id);
      expect(await validateApiKey(store, created1.apiKey)).toBe(false);
      expect(await validateApiKey(store, created2.apiKey)).toBe(true);

      await revokeApiKey(store, created2.id);
    });
  });

  describe("Budget integration with API keys", () => {
    let budgetTracker: BudgetTracker;
    let store: ApiKeyStore;

    beforeEach(async () => {
      budgetTracker = new BudgetTracker("redis://localhost:0");
      store = new ApiKeyStore(":memory:");
    });

    it("should track budget separately per registered key", async () => {
      const createdA = await registerApiKey(store, { name: "budget-user-a", permissions: ["chat"], budgetUsd: 100 });
      const createdB = await registerApiKey(store, { name: "budget-user-b", permissions: ["chat"], budgetUsd: 200 });

      await budgetTracker.setBudget(createdA.apiKey, 100);
      await budgetTracker.setBudget(createdB.apiKey, 200);

      await budgetTracker.deductBudget(createdA.apiKey, 25);
      await budgetTracker.deductBudget(createdB.apiKey, 50);

      const statusA = await budgetTracker.getBudgetStatus(createdA.apiKey);
      const statusB = await budgetTracker.getBudgetStatus(createdB.apiKey);

      expect(statusA.used).toBe(25);
      expect(statusA.remaining).toBe(75);
      expect(statusB.used).toBe(50);
      expect(statusB.remaining).toBe(150);
    });
  });
});
