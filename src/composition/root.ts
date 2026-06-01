/** Composition root - wires together Clean Architecture components.
 * This is the only place where concrete implementations are instantiated.
 * All dependencies flow inward: Infrastructure → Application → Domain
 */

import type { GatewayConfig } from "../types";
import { ProcessChatCompletion } from "../application/usecases/ProcessChatCompletion";
import { RoutingService } from "../domain/services/RoutingService";
import { CacheAdapter } from "../infrastructure/persistence/CacheAdapter";
import { AuditAdapter } from "../infrastructure/persistence/AuditAdapter";
import { BudgetAdapter } from "../infrastructure/persistence/BudgetAdapter";
import { AuthAdapter } from "../infrastructure/persistence/AuthAdapter";
import { CircuitBreakerAdapter } from "../infrastructure/resilience/CircuitBreakerAdapter";
import { ProviderAdapter } from "../infrastructure/providers/ProviderAdapter";
import { getProvider } from "../providers/registry";

export interface ComposedApplication {
  processChatCompletion: ProcessChatCompletion;
  cache: CacheAdapter;
  auditLog: AuditAdapter;
  budgetTracker: BudgetAdapter;
  auth: AuthAdapter;
  circuitBreaker: CircuitBreakerAdapter;
}

export function composeApplication(config: GatewayConfig): ComposedApplication {
  // Infrastructure layer - external dependencies
  const cache = new CacheAdapter(config.redisUrl);
  const auditLog = new AuditAdapter(config.databasePath);
  const budgetTracker = new BudgetAdapter(config.redisUrl, config.budgets.globalLimitUsd);
  const auth = new AuthAdapter(config.databasePath);
  const circuitBreaker = new CircuitBreakerAdapter();

  // Provider adapters - wrap existing providers
  const providers = new Map<string, ProviderAdapter>();
  for (const [name] of Object.entries(config.providers)) {
    const provider = getProvider(name, config);
    if (provider) {
      providers.set(name, new ProviderAdapter(name, provider));
    }
  }

  // Domain service - pure business logic
  const routingService = new RoutingService();

  // Application use case - orchestration with injected dependencies
  const processChatCompletion = new ProcessChatCompletion({
    routingService,
    providers,
    cache,
    auditLog,
    budgetTracker,
    circuitBreaker,
    circuitBreakerConfig: config.routing.fallback.circuitBreaker,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    cacheTtlMs: 3600000, // 1 hour
  });

  return {
    processChatCompletion,
    cache,
    auditLog,
    budgetTracker,
    auth,
    circuitBreaker,
  };
}
