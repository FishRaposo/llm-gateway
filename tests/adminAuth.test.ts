import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createAdminRouter } from "../src/admin/routes";
import { registerApiKey } from "../src/middleware/auth";
import { ApiKeyStore } from "../src/storage/apiKeyStore";
import { BudgetTracker } from "../src/storage/budgetTracker";
import { CacheStore } from "../src/storage/cacheStore";
import { AuditLogStorage } from "../src/storage/auditLog";
import type { GatewayConfig, AuditEntry } from "../src/types";

const config: GatewayConfig = {
  port: 0,
  logLevel: "info",
  defaultModel: "gpt-4o-mini",
  defaultProvider: "openai",
  databasePath: ":memory:",
  redisUrl: "redis://localhost:0",
  gatewayApiKey: "bootstrap-admin-key",
  providers: {},
  routing: {
    default: { provider: "openai", model: "gpt-4o-mini" },
    rules: [],
    fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
  },
  policy: { enabled: false, evalOrder: [], rules: [] },
  budgets: { enabled: false, globalLimitUsd: 1000, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
};

describe("Admin /admin/* authorization guard (HTTP level)", () => {
  let server: Server;
  let baseUrl: string;
  let apiKeyStore: ApiKeyStore;
  let nonAdminKey: string;
  let adminStoreKey: string;

  beforeAll(async () => {
    apiKeyStore = new ApiKeyStore(":memory:");

    // A regular tenant key created via the store (permissions: ["chat"]).
    const nonAdmin = await registerApiKey(apiKeyStore, { name: "tenant", permissions: ["chat"], budgetUsd: 50 });
    nonAdminKey = nonAdmin.apiKey;

    // A store key that explicitly carries the admin ('*') permission.
    const admin = await registerApiKey(apiKeyStore, { name: "ops", permissions: ["*"], budgetUsd: 1000 });
    adminStoreKey = admin.apiKey;

    const storage = {
      auditLog: new AuditLogStorage(":memory:"),
      cacheStore: new CacheStore("redis://localhost:0"),
      budgetTracker: new BudgetTracker("redis://localhost:0"),
      apiKeyStore,
    };

    const app = express();
    app.use(express.json());
    app.use("/admin", createAdminRouter(storage, config));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function getBudgets(key?: string): Promise<number> {
    const res = await fetch(`${baseUrl}/admin/budgets`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    return res.status;
  }

  it("rejects requests with no API key (401)", async () => {
    expect(await getBudgets(undefined)).toBe(401);
  });

  it("rejects an invalid/unknown key (401)", async () => {
    expect(await getBudgets("definitely-not-a-key")).toBe(401);
  });

  it("rejects a valid NON-ADMIN tenant key with 403 (no privilege escalation)", async () => {
    expect(await getBudgets(nonAdminKey)).toBe(403);
  });

  it("accepts the configured bootstrap admin key (200)", async () => {
    expect(await getBudgets(config.gatewayApiKey)).toBe(200);
  });

  it("accepts a store key carrying the admin '*' permission (200)", async () => {
    expect(await getBudgets(adminStoreKey)).toBe(200);
  });
});

describe("Audit log redaction (no raw API key persisted)", () => {
  it("stores only a masked key, never the raw secret", async () => {
    const auditLog = new AuditLogStorage(":memory:");
    const rawKey = "gw-1234567890-supersecretvalue";

    const entry: AuditEntry = {
      id: "audit-1",
      timestamp: new Date().toISOString(),
      apiKey: rawKey,
      apiKeyName: "tenant",
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      latencyMs: 12,
      status: "success",
      cacheHit: false,
      fallbackUsed: false,
    };

    // Capture the in-memory fallback path by swapping console.log directly
    // (vitest's own console wrapper makes vi.spyOn unreliable for this).
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
    try {
      await auditLog.write(entry);
    } finally {
      console.log = originalLog;
    }

    const rows = await auditLog.query({ limit: 10 });
    const logged = captured.join("\n");

    if (rows.length > 0) {
      // SQLite-backed: the persisted row must carry the masked key only.
      const row = rows.find((r) => r.id === "audit-1") ?? rows[0];
      expect(row.apiKey).toBe("gw-12345...");
      expect(row.apiKey).not.toContain("supersecretvalue");
    } else {
      // In-memory fallback: the serialized entry must not leak the raw secret.
      expect(logged).not.toContain(rawKey);
      expect(logged).not.toContain("supersecretvalue");
      expect(logged).toContain("gw-12345...");
    }
  });
});
