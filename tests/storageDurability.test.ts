/** Storage durability: audit entries and API keys survive a process restart. */
import { describe, it, expect, afterEach } from "vitest";
import { AuditLogStorage } from "../src/storage/auditLog";
import { ApiKeyStore } from "../src/storage/apiKeyStore";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const files: string[] = [];
function tmpDb(name: string): string {
  const p = join(tmpdir(), `gw-dur-${name}-${process.pid}-${Date.now()}.db`);
  files.push(p);
  return p;
}

afterEach(() => {
  for (const f of files.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(f + suffix)) unlinkSync(f + suffix);
    }
  }
});

describe("Storage durability across restart", () => {
  it("audit entries written before close are readable from a fresh instance", async () => {
    const dbPath = tmpDb("audit");
    const first = new AuditLogStorage(dbPath);
    await first.write({
      id: "persisted-1",
      timestamp: new Date().toISOString(),
      apiKey: "gw-test-secret",
      apiKeyName: "svc",
      accountId: "acct-9",
      model: "m",
      provider: "mock",
      inputTokens: 3,
      outputTokens: 5,
      costUsd: 0.01,
      latencyMs: 42,
      status: "success",
      cacheHit: false,
      fallbackUsed: false,
      costBasis: "measured",
    });
    first.close();

    // Simulated restart: a new instance on the same path.
    const second = new AuditLogStorage(dbPath);
    const rows = await second.query({ apiKey: undefined });
    const found = rows.find((r) => r.id === "persisted-1");
    expect(found).toBeTruthy();
    expect(found?.accountId).toBe("acct-9");
    expect(found?.costBasis).toBe("measured");
    expect(found?.apiKey).not.toContain("secret");
    second.close();
  });

  it("api keys validate on a fresh instance after close (bcrypt + fingerprint persist)", async () => {
    const dbPath = tmpDb("keys");
    const first = new ApiKeyStore(dbPath);
    const { apiKey, record } = await first.create({ name: "restart-proof", budgetUsd: 7 });
    first.close();

    const second = new ApiKeyStore(dbPath);
    const result = await second.validate(apiKey);
    expect(result.valid).toBe(true);
    expect(result.record?.id).toBe(record.id);
    expect(result.record?.budgetUsd).toBe(7);
    second.close();
  });

  it("pre-existing databases gain new columns via additive migration", async () => {
    // Build an "old" database without the new columns, then let the store migrate it.
    const dbPath = tmpDb("migrate");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      permissions TEXT NOT NULL DEFAULT 'chat', budget_usd REAL NOT NULL DEFAULT 100,
      allowed_models TEXT NOT NULL DEFAULT '*', expires_at TEXT, created_at TEXT NOT NULL
    )`);
    const bcrypt = (await import("bcryptjs")).default;
    const legacyKey = "gw-legacy-migration-test";
    db.prepare(
      "INSERT INTO api_keys (id, name, key_hash, permissions, budget_usd, allowed_models, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run("legacy-1", "legacy", bcrypt.hashSync(legacyKey, 12), '["chat"]', 5, '["*"]', null, "2026-01-01T00:00:00Z");
    db.close();

    const store = new ApiKeyStore(dbPath);
    const result = await store.validate(legacyKey);
    expect(result.valid).toBe(true);
    expect(result.record?.id).toBe("legacy-1");
    // The legacy row was backfilled with its fingerprint.
    const check = new Database(dbPath);
    const row = check.prepare("SELECT key_fingerprint FROM api_keys WHERE id = 'legacy-1'").get() as { key_fingerprint: string | null };
    check.close();
    expect(row.key_fingerprint).toBeTruthy();
    store.close();
  });
});
