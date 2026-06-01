/** Audit port - interface for audit logging.
 * Domain defines the contract, infrastructure implements it.
 */

import type { AuditEntry, AuditStatus } from "../models/Audit";

export interface LogFilters {
  apiKey?: string;
  model?: string;
  provider?: string;
  status?: AuditStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPort {
  write(entry: AuditEntry): Promise<void>;

  query(filters: LogFilters): Promise<AuditEntry[]>;

  ping(): Promise<boolean>;

  close(): Promise<void>;
}
