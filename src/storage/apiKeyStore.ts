/** Persistent API key storage backed by SQLite with bcrypt hashing and in-memory fallback. */

import { v4 as uuidv4 } from "uuid";

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyHash: string;
  permissions: string[];
  budgetUsd: number;
  allowedModels: string[];
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreateInput {
  name: string;
  permissions?: string[];
  budgetUsd?: number;
  allowedModels?: string[];
  expiresAt?: string | null;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  record?: ApiKeyRecord;
}

export class ApiKeyStore {
  private dbPath: string;
  private db: import("better-sqlite3").Database | null = null;
  private memoryFallback = new Map<string, ApiKeyRecord>();
  private memoryHashFallback = new Map<string, string>(); // key -> keyHash

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async initialize(): Promise<void> {
    if (this.db) return;
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(this.dbPath);
      this.db = db;
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          permissions TEXT NOT NULL DEFAULT 'chat',
          budget_usd REAL NOT NULL DEFAULT 100,
          allowed_models TEXT NOT NULL DEFAULT '*',
          expires_at TEXT,
          created_at TEXT NOT NULL
        )
      `);
    } catch {
      console.warn("[ApiKeyStore] SQLite unavailable, using in-memory fallback");
    }
  }

  private async getDb(): Promise<import("better-sqlite3").Database | null> {
    await this.initialize();
    return this.db;
  }

  async create(input: ApiKeyCreateInput): Promise<{ apiKey: string; record: ApiKeyRecord }> {
    const apiKey = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const record: ApiKeyRecord = {
      id: uuidv4(),
      name: input.name || "unnamed",
      keyHash: await this._hash(apiKey),
      permissions: input.permissions ?? ["chat"],
      budgetUsd: input.budgetUsd ?? 100,
      allowedModels: input.allowedModels ?? ["*"],
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date().toISOString(),
    };

    const db = await this.getDb();
    if (db) {
      db.prepare(
        `INSERT INTO api_keys (id, name, key_hash, permissions, budget_usd, allowed_models, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id,
        record.name,
        record.keyHash,
        JSON.stringify(record.permissions),
        record.budgetUsd,
        JSON.stringify(record.allowedModels),
        record.expiresAt,
        record.createdAt
      );
    } else {
      this.memoryFallback.set(record.id, record);
      this.memoryHashFallback.set(apiKey, record.keyHash);
    }

    return { apiKey, record };
  }

  async validate(apiKey: string): Promise<ApiKeyValidationResult> {
    const db = await this.getDb();
    if (db) {
      const rows = db.prepare("SELECT * FROM api_keys").all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const keyHash = row.key_hash as string;
        if (await this._compare(apiKey, keyHash)) {
          const record = this._deserialize(row);
          if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            return { valid: false };
          }
          return { valid: true, record };
        }
      }
      return { valid: false };
    }

    // In-memory fallback: compare stored hash against key
    for (const [storedKey, storedHash] of this.memoryHashFallback.entries()) {
      if (storedKey === apiKey) {
        const record = Array.from(this.memoryFallback.values()).find((r) => r.keyHash === storedHash);
        if (record) {
          if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            return { valid: false };
          }
          return { valid: true, record };
        }
      }
    }
    return { valid: false };
  }

  async list(): Promise<ApiKeyRecord[]> {
    const db = await this.getDb();
    if (db) {
      const rows = db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
      return rows.map((row) => this._deserialize(row));
    }
    return Array.from(this.memoryFallback.values());
  }

  async revoke(id: string): Promise<boolean> {
    const db = await this.getDb();
    if (db) {
      const result = db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
      return (result.changes ?? 0) > 0;
    }
    const record = this.memoryFallback.get(id);
    if (!record) return false;
    this.memoryFallback.delete(id);
    for (const [key, hash] of this.memoryHashFallback.entries()) {
      if (hash === record.keyHash) {
        this.memoryHashFallback.delete(key);
        break;
      }
    }
    return true;
  }

  private async _hash(plain: string): Promise<string> {
    const bcrypt = await import("bcryptjs");
    return bcrypt.hashSync(plain, 12);
  }

  private async _compare(plain: string, hash: string): Promise<boolean> {
    const bcrypt = await import("bcryptjs");
    return bcrypt.compareSync(plain, hash);
  }

  private _deserialize(row: Record<string, unknown>): ApiKeyRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      keyHash: row.key_hash as string,
      permissions: JSON.parse((row.permissions as string) || "[]"),
      budgetUsd: row.budget_usd as number,
      allowedModels: JSON.parse((row.allowed_models as string) || "[]"),
      expiresAt: (row.expires_at as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  }
}
