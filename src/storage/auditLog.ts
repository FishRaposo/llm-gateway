/** Audit log storage using SQLite for persistent request/response logging. */

import type { AuditEntry, LogFilters } from "../types";

export class AuditLogStorage {
  private dbPath: string;
  private db: import("better-sqlite3").Database | null = null;

  /**
   * @param dbPath - Path to the SQLite database file.
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initializes the SQLite database and creates the audit log table.
   */
  private async initialize(): Promise<void> {
    if (this.db) return;

    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(this.dbPath);
      this.db = db;
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          api_key TEXT NOT NULL,
          api_key_name TEXT NOT NULL,
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          cost_usd REAL DEFAULT 0,
          latency_ms INTEGER DEFAULT 0,
          status TEXT NOT NULL,
          error_message TEXT,
          routing_decision TEXT,
          cache_hit INTEGER DEFAULT 0,
          fallback_used INTEGER DEFAULT 0
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_audit_api_key ON audit_log(api_key)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_audit_model ON audit_log(model)");
    } catch {
      console.warn("[AuditLog] SQLite not available, falling back to in-memory logging");
    }
  }

  /**
   * Writes an audit entry to the database.
   * @param entry - Audit entry to persist.
   */
  async write(entry: AuditEntry): Promise<void> {
    await this.initialize();

    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO audit_log (id, timestamp, api_key, api_key_name, model, provider,
          input_tokens, output_tokens, cost_usd, latency_ms, status, error_message,
          routing_decision, cache_hit, fallback_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        entry.id,
        entry.timestamp,
        entry.apiKey,
        entry.apiKeyName,
        entry.model,
        entry.provider,
        entry.inputTokens,
        entry.outputTokens,
        entry.costUsd,
        entry.latencyMs,
        entry.status,
        entry.errorMessage ?? null,
        entry.routingDecision ?? null,
        entry.cacheHit ? 1 : 0,
        entry.fallbackUsed ? 1 : 0
      );
    } else {
      console.log("[AuditLog]", JSON.stringify(entry));
    }
  }

  /**
   * Queries audit log entries with optional filters.
   * @param filters - Filter criteria for the query.
   * @returns Array of matching audit entries.
   */
  async query(filters: LogFilters): Promise<AuditEntry[]> {
    await this.initialize();

    if (!this.db) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.apiKey) {
      conditions.push("api_key = ?");
      params.push(filters.apiKey);
    }
    if (filters.model) {
      conditions.push("model = ?");
      params.push(filters.model);
    }
    if (filters.provider) {
      conditions.push("provider = ?");
      params.push(filters.provider);
    }
    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }
    if (filters.from) {
      conditions.push("timestamp >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("timestamp <= ?");
      params.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const stmt = this.db.prepare(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    );

    const rows = stmt.all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      timestamp: row.timestamp as string,
      apiKey: row.api_key as string,
      apiKeyName: row.api_key_name as string,
      model: row.model as string,
      provider: row.provider as string,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      costUsd: row.cost_usd as number,
      latencyMs: row.latency_ms as number,
      status: row.status as AuditEntry["status"],
      errorMessage: row.error_message as string | undefined,
      routingDecision: row.routing_decision as string | undefined,
      cacheHit: Boolean(row.cache_hit),
      fallbackUsed: Boolean(row.fallback_used),
    }));
  }

  /**
   * Pings the database to verify connectivity.
   * @returns True if the database is reachable, false otherwise.
   */
  async ping(): Promise<boolean> {
    await this.initialize();
    if (!this.db) return false;
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
