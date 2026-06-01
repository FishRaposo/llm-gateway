/** Domain service for routing decisions.
 * Pure business logic with no external dependencies.
 */

import type { ChatRequest } from "../models/Request";
import type { RoutingDecision, ProviderInfo } from "../models/Routing";

export interface RoutingRule {
  name: string;
  condition: (request: ChatRequest, providers: ProviderInfo[]) => boolean;
  action: (request: ChatRequest, providers: ProviderInfo[]) => RoutingDecision;
}

export class RoutingService {
  private rules: RoutingRule[] = [];

  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
  }

  route(
    request: ChatRequest,
    providers: ProviderInfo[],
    defaultProvider: string,
    defaultModel: string
  ): RoutingDecision {
    // Try rules in order
    for (const rule of this.rules) {
      if (rule.condition(request, providers)) {
        return rule.action(request, providers);
      }
    }

    // Default routing
    const healthyProviders = providers.filter((p) => p.health === "healthy");

    if (healthyProviders.length === 0) {
      // Fall back to default even if unhealthy
      return {
        selectedProvider: defaultProvider,
        selectedModel: request.originalModel || defaultModel,
        fallbackUsed: false,
        ruleMatched: "default_no_healthy",
        alternatives: [],
      };
    }

    // Find provider that supports the requested model
    const preferredProvider = healthyProviders.find((p) =>
      p.availableModels.includes(request.originalModel)
    );

    if (preferredProvider) {
      return {
        selectedProvider: preferredProvider.name,
        selectedModel: request.originalModel,
        fallbackUsed: false,
        ruleMatched: "default",
        alternatives: healthyProviders
          .filter((p) => p.name !== preferredProvider.name)
          .map((p) => ({ provider: p.name, model: p.availableModels[0] || defaultModel })),
      };
    }

    // Model not available, use default model from first healthy provider
    return {
      selectedProvider: healthyProviders[0].name,
      selectedModel: defaultModel,
      fallbackUsed: false,
      ruleMatched: "default_model_fallback",
      alternatives: healthyProviders.slice(1).map((p) => ({
        provider: p.name,
        model: p.availableModels[0] || defaultModel,
      })),
    };
  }
}
