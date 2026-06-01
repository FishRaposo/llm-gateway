/** Audit adapter - implements AuditPort using existing AuditLogStorage.
 * Infrastructure layer - wraps external storage with domain interface.
 */

import type { AuditPort, LogFilters } from "../../domain/ports/AuditPort";
import type { AuditEntry } from "../../domain/models/Audit";
import { AuditLogStorage } from "../../storage/auditLog";

export class AuditAdapter implements AuditPort {
  private storage: AuditLogStorage;

  constructor(dbPath: string) {
    this.storage = new AuditLogStorage(dbPath);
  }

  async write(entry: AuditEntry): Promise<void> {
    await this.storage.write(entry);
  }

  async query(filters: LogFilters): Promise<AuditEntry[]> {
    return this.storage.query(filters);
  }

  async ping(): Promise<boolean> {
    return this.storage.ping();
  }

  async close(): Promise<void> {
    this.storage.close();
  }
}
