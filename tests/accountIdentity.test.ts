/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStreamingRequest } from "../src/proxy/streaming";
import { createAuthMiddleware } from "../src/middleware/auth";
import { createBudgetMiddleware } from "../src/middleware/budget";
import { createRateLimitMiddleware, getRateLimitStatus } from "../src/middleware/rateLimit";
import { generateCacheKey } from "../src/middleware/cache";
import { AuditLogStorage } from "../src/storage/auditLog";
import { ApiKeyStore } from "../src/storage/apiKeyStore";
import { BudgetTracker } from "../src/storage/budgetTracker";
import type { RequestContext } from "../src/types/routing";
import type { GatewayConfig } from "../src/types";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 3000,
    logLevel: "info",
    defaultModel: "gpt-4o-mini",
    defaultProvider: "mock",
    databasePath: ":memory:",
    redisUrl: "redis://localhost:0",
    gatewayApiKey: "admin-key",
    providers: { mock: { type: "mock", apiKey: "mock-key" } },
    routing: {
      default: { provider: "mock", model: "mock-model" },
      rules: [],
      fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
    },
    policy: { enabled: false, evalOrder: [], rules: [] },
    budgets: { enabled: true, globalLimitUsd: Infinity, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
    ...overrides,
  };
}

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "req-identity",
    apiKey: "gw-plaintext-secret",
    apiKeyName: "tester",
    apiKeyId: "record-id-1",
    accountId: "record-id-1",
    permissions: ["chat"],
    originalModel: "mock-model",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
    metadata: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const decision = {
  selectedProvider: "mock",
  selectedModel: "mock-model",
  fallbackUsed: false,
  ruleMatched: "default",
  alternatives: [],
};

const providerRequest = {
  model: "mock-model",
  messages: [{ role: "user" as const, content: "Hello" }],
  stream: true,
  metadata: {},
};

describe("Canonical account identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auth middleware stamps accountId from the key record id", async () => {
    const store = {
      validate: vi.fn().mockResolvedValue({
        valid: true,
        record: { id: "rec-abc", name: "svc", permissions: ["chat"], keyHash: "h", budgetUsd: 1, allowedModels: ["*"], expiresAt: null, createdAt: "t" },
      }),
    };
    const middleware = createAuthMiddleware(makeConfig(), store as any);
    const ctx = await middleware(makeContext({ accountId: undefined }), makeConfig());
    expect(ctx?.accountId).toBe("rec-abc");
  });

  it("auth middleware stamps accountId for the bootstrap admin key", async () => {
    const store = { validate: vi.fn() };
    const middleware = createAuthMiddleware(makeConfig(), store as any);
    const ctx = await middleware(makeContext({ apiKey: "admin-key", accountId: undefined, apiKeyId: undefined }), makeConfig());
    expect(ctx?.accountId).toBe("admin");
  });

  it("streamed spend deducts under accountId, never the plaintext key", async () => {
    const res = { setHeader: vi.fn(), write: vi.fn().mockReturnValue(true), end: vi.fn() };
    const deduct = vi.fn().mockResolvedValue(undefined);
    const storage = {
      auditLog: { write: vi.fn().mockResolvedValue(undefined) },
      cacheStore: { set: vi.fn(), get: vi.fn().mockResolvedValue(null) },
      budgetTracker: { deductBudget: deduct },
      apiKeyStore: {},
    } as any;
    const ctx = makeContext();
    await handleStreamingRequest({} as any, res as any, ctx, providerRequest as any, "mock", makeConfig(), decision as any, storage);
    expect(deduct).toHaveBeenCalled();
    const [identity] = deduct.mock.calls[0];
    expect(identity).toBe("record-id-1");
    expect(identity).not.toBe("gw-plaintext-secret");
  });

  it("budget enforcement prefers accountId over plaintext key", async () => {
    const tracker = new BudgetTracker("redis://localhost:0", Infinity);
    await tracker.setBudget("record-id-1", 0); // exhausted limit under the record id
    const middleware = createBudgetMiddleware(makeConfig(), tracker);
    // Plaintext identity would have an unlimited budget; the record-id limit must win.
    await expect(middleware(makeContext(), makeConfig())).rejects.toMatchObject({ code: "budget_exceeded" });
  });

  it("cache keys isolate accounts for identical prompts", () => {
    const shared = { originalModel: "m", messages: [{ role: "user" as const, content: "same prompt" }], stream: false };
    const a = generateCacheKey(makeContext({ ...shared, accountId: "acct-a", stream: false }));
    const b = generateCacheKey(makeContext({ ...shared, accountId: "acct-b", stream: false }));
    const aAgain = generateCacheKey(makeContext({ ...shared, accountId: "acct-a", apiKey: "rotated-plaintext-2", stream: false }));
    expect(a).not.toBe(b);
    // Rotated credentials must not fragment the account's own cache.
    expect(a).toBe(aAgain);
  });

  it("rate limiting counts under accountId, not the plaintext key", async () => {
    const middleware = createRateLimitMiddleware(makeConfig());
    const ctx = makeContext({ accountId: "rate-acct-identity" });
    await middleware(ctx, makeConfig());
    const byAccount = await getRateLimitStatus("rate-acct-identity");
    const byPlaintext = await getRateLimitStatus("gw-plaintext-secret");
    expect(byAccount.count).toBe(1);
    expect(byPlaintext.count).toBe(0);
  });

  it("audit rows carry accountId and only the masked credential", async () => {
    const dbPath = join(tmpdir(), `gw-audit-ident-${process.pid}-${Date.now()}.db`);
    try {
      const log = new AuditLogStorage(dbPath);
      await log.write({
        id: "e1",
        timestamp: new Date().toISOString(),
        apiKey: "gw-plaintext-secret",
        apiKeyName: "tester",
        accountId: "record-id-1",
        model: "m",
        provider: "p",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.001,
        latencyMs: 5,
        status: "success",
        cacheHit: false,
        fallbackUsed: false,
      });
      const rows = await log.query({});
      expect(rows).toHaveLength(1);
      expect(rows[0].accountId).toBe("record-id-1");
      expect(rows[0].apiKey).not.toContain("secret");
      log.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
      }
    }
  });

  it("key validation uses the fingerprint index and stores no plaintext", async () => {
    const dbPath = join(tmpdir(), `gw-keys-ident-${process.pid}-${Date.now()}.db`);
    try {
      const store = new ApiKeyStore(dbPath);
      const { apiKey, record } = await store.create({ name: "svc" });
      const result = await store.validate(apiKey);
      expect(result.valid).toBe(true);
      expect(result.record?.id).toBe(record.id);

      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath);
      const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(record.id) as any;
      db.close();
      expect(row.key_fingerprint).toBeTruthy();
      const rowText = JSON.stringify(row);
      expect(rowText).not.toContain(apiKey);
      store.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
      }
    }
  });
});
