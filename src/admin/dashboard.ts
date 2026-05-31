/** Dashboard data aggregation for admin API. */

import type { GatewayConfig, UsageStats, CostBreakdown } from "../types";
import type { AuditLogStorage } from "../storage/auditLog";
import type { ProviderHealth } from "../types/provider";
import { getProvider } from "../providers/registry";

/**
 * Aggregates usage statistics from the audit log.
 * @param auditLog - Audit log storage backend.
 * @returns Usage stats by model and provider.
 */
export async function getUsageStats(auditLog: AuditLogStorage): Promise<UsageStats> {
  const entries = await auditLog.query({ limit: 10000 });
  const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {};
  const byProvider: Record<string, { requests: number; errors: number }> = {};

  let totalRequests = entries.length;
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const entry of entries) {
    totalTokens += entry.inputTokens + entry.outputTokens;
    totalCostUsd += entry.costUsd;

    if (!byModel[entry.model]) {
      byModel[entry.model] = { requests: 0, tokens: 0, cost: 0 };
    }
    byModel[entry.model].requests++;
    byModel[entry.model].tokens += entry.inputTokens + entry.outputTokens;
    byModel[entry.model].cost += entry.costUsd;

    if (!byProvider[entry.provider]) {
      byProvider[entry.provider] = { requests: 0, errors: 0 };
    }
    byProvider[entry.provider].requests++;
    if (entry.status === "error") {
      byProvider[entry.provider].errors++;
    }
  }

  return {
    totalRequests,
    totalTokens,
    totalCostUsd,
    byModel,
    byProvider,
  };
}

/**
 * Computes a cost breakdown for the current period.
 * @param auditLog - Audit log storage backend.
 * @returns Cost breakdown by model and API key.
 */
export async function getCostBreakdown(auditLog: AuditLogStorage): Promise<CostBreakdown> {
  const entries = await auditLog.query({ limit: 10000 });

  let totalCostUsd = 0;
  const byModel: Record<string, number> = {};
  const byApiKey: Record<string, number> = {};

  for (const entry of entries) {
    totalCostUsd += entry.costUsd;
    byModel[entry.model] = (byModel[entry.model] ?? 0) + entry.costUsd;
    byApiKey[entry.apiKey] = (byApiKey[entry.apiKey] ?? 0) + entry.costUsd;
  }

  return {
    period: "current",
    totalCostUsd,
    byModel,
    byApiKey,
  };
}

/**
 * Checks the health of all configured providers.
 * @param config - Gateway configuration.
 * @returns Map of provider names to health status.
 */
export async function getProviderHealth(config: GatewayConfig): Promise<Record<string, ProviderHealth>> {
  const results: Record<string, ProviderHealth> = {};

  for (const name of Object.keys(config.providers)) {
    try {
      const provider = getProvider(name, config);
      results[name] = await provider.healthCheck();
    } catch {
      results[name] = {
        status: "unhealthy",
        latencyMs: 0,
        errorRate: 1,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 1,
      };
    }
  }

  return results;
}
