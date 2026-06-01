/** Domain model for audit log entries.
 * Pure business entity with no external dependencies.
 */

export type AuditStatus = "success" | "error" | "cached" | "policy_denied" | "budget_exceeded" | "rate_limited";

export interface AuditEntry {
  id: string;
  timestamp: string;
  apiKey: string;
  apiKeyName: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: AuditStatus;
  errorMessage?: string;
  routingDecision?: string;
  cacheHit: boolean;
  fallbackUsed: boolean;
}
