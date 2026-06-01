/** Core type definitions for the LLM Gateway. */

export interface GatewayConfig {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  defaultModel: string;
  defaultProvider: string;
  databasePath: string;
  redisUrl: string;
  gatewayApiKey: string;
  providers: Record<string, ProviderConfig>;
  routing: RoutingConfig;
  policy: PolicyConfig;
  budgets: BudgetConfig;
}

export interface ProviderConfig {
  type: "openai" | "anthropic" | "gemini" | "ollama" | "mock";
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  timeout?: number;
  maxRetries?: number;
}

export interface RoutingConfig {
  default: {
    provider: string;
    model: string;
  };
  rules: RoutingRule[];
  fallback: {
    enabled: boolean;
    maxRetries: number;
    circuitBreaker: {
      failureThreshold: number;
      resetTimeoutMs: number;
    };
  };
}

export interface PolicyConfig {
  enabled: boolean;
  evalOrder: string[];
  rules: PolicyRuleConfig[];
}

export interface BudgetConfig {
  enabled: boolean;
  globalLimitUsd: number;
  defaultKeyBudgetUsd: number;
  period: "daily" | "weekly" | "monthly";
  alertThresholdPercent: number;
}

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
  status: "success" | "error" | "cached" | "policy_denied" | "budget_exceeded" | "rate_limited";
  errorMessage?: string;
  routingDecision?: string;
  cacheHit: boolean;
  fallbackUsed: boolean;
}

export interface LogFilters {
  apiKey?: string;
  model?: string;
  provider?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: Record<string, ModelUsageStats>;
  byProvider: Record<string, ProviderUsageStats>;
}

export interface ModelUsageStats {
  requests: number;
  tokens: number;
  cost: number;
}

export interface ProviderUsageStats {
  requests: number;
  errors: number;
}

export interface CostBreakdown {
  period: string;
  totalCostUsd: number;
  byModel: Record<string, number>;
  byApiKey: Record<string, number>;
}

export interface ApiKeyInfo {
  key: string;
  name: string;
  budgetLimitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  period: string;
  resetDate: string;
  allowedModels: string[];
  rateLimitRpm: number;
  active: boolean;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  providers: Record<string, ProviderHealthStatus>;
  redis: "connected" | "disconnected";
  database: "connected" | "disconnected";
  uptimeSeconds: number;
}

export interface ProviderHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  errorRate: number;
  lastCheck: string;
}

export interface RoutingRule {
  type: "model_preference" | "cost_optimize" | "latency_optimize" | "fallback_chain";
  priority: number;
  model?: string;
  models?: string[];
  provider?: string;
  capability?: string;
  preferCheapest?: boolean;
  maxLatencyMs?: number;
  chain?: FallbackChainEntry[];
  alternatives?: FallbackChainEntry[];
}

export interface FallbackChainEntry {
  provider: string;
  model: string;
}

export interface PolicyRuleConfig {
  type: "content_filter" | "pii_detection" | "model_restriction" | "request_modify";
  action: "allow" | "deny" | "modify" | "flag";
  patterns?: string[];
  caseSensitive?: boolean;
  detect?: string[];
  onDetection?: string;
  allowedModels?: string[];
  blockedModels?: string[];
  modifications?: RequestModification[];
}

export interface RequestModification {
  field: string;
  max?: number;
  min?: number;
  value?: unknown;
  onViolation: "clamp" | "deny" | "default";
}

export { RequestContext, GatewayResponse } from "./routing";
export { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "./provider";
export { PolicyDecision } from "./policy";
