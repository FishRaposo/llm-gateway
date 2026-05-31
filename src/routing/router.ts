/** Router that evaluates routing rules and selects the best provider/model. */

import type { RoutingConfig, RoutingRule } from "../types";
import type { RequestContext, RoutingDecision, RoutingAlternative } from "../types/routing";
import { evaluateRules } from "./rules";

/**
 * Evaluates routing configuration to determine which provider and model to use.
 */
export class Router {
  private config: RoutingConfig;

  /**
   * @param config - Routing configuration with rules and defaults.
   */
  constructor(config: RoutingConfig) {
    this.config = config;
  }

  /**
   * Routes a request to the best provider and model based on configured rules.
   * @param request - The current request context.
   * @returns Routing decision with selected provider, model, and alternatives.
   */
  route(request: RequestContext): RoutingDecision {
    const sortedRules = [...this.config.rules].sort((a, b) => b.priority - a.priority);

    const alternatives = this.buildAlternatives(sortedRules);

    const decision = evaluateRules(sortedRules, request);
    if (decision) {
      return { ...decision, alternatives };
    }

    return {
      selectedProvider: this.config.default.provider,
      selectedModel: this.config.default.model,
      fallbackUsed: false,
      ruleMatched: "default",
      alternatives,
    };
  }

  /**
   * Builds a list of alternative routing options from fallback chain rules.
   * @param rules - Sorted routing rules.
   * @returns Array of alternative routing options.
   */
  private buildAlternatives(rules: RoutingRule[]): RoutingAlternative[] {
    const alternatives: RoutingAlternative[] = [];

    for (const rule of rules) {
      if (rule.type === "fallback_chain" && rule.chain) {
        for (const entry of rule.chain) {
          alternatives.push({ provider: entry.provider, model: entry.model, priority: rule.priority });
        }
      }
    }

    return alternatives;
  }
}
