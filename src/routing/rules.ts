/** Rule evaluation logic for the routing engine. */

import type { RoutingRule } from "../types";
import type { RequestContext, RoutingDecision } from "../types/routing";
import { getPricing } from "../shared/pricing";

/**
 * Evaluates routing rules in order against a request context.
 * @param rules - Routing rules sorted by priority (highest first).
 * @param request - The current request context.
 * @returns Routing decision if a rule matches, or null.
 */
export function evaluateRules(
  rules: RoutingRule[],
  request: RequestContext
): RoutingDecision | null {
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sortedRules) {
    const decision = evaluateRule(rule, request);
    if (decision) {
      return decision;
    }
  }
  return null;
}

/**
 * Evaluates a single routing rule against a request.
 * @param rule - The routing rule to evaluate.
 * @param request - The current request context.
 * @returns Routing decision if the rule matches, or null.
 */
function evaluateRule(rule: RoutingRule, request: RequestContext): RoutingDecision | null {
  switch (rule.type) {
    case "model_preference":
      return evaluateModelPreference(rule, request);
    case "cost_optimize":
      return evaluateCostOptimize(rule, request);
    case "latency_optimize":
      return evaluateLatencyOptimize(rule, request);
    case "fallback_chain":
      return evaluateFallbackChain(rule, request);
    default:
      return null;
  }
}

/**
 * Matches a request's model to a preferred provider.
 * @param rule - Model preference rule.
 * @param request - Request context with original model name.
 * @returns Decision if model matches, null otherwise.
 */
function evaluateModelPreference(rule: RoutingRule, request: RequestContext): RoutingDecision | null {
  if (rule.model && request.originalModel === rule.model && rule.provider) {
    return {
      selectedProvider: rule.provider,
      selectedModel: rule.model,
      fallbackUsed: false,
      ruleMatched: `model_preference:${rule.model}`,
      alternatives: [],
    };
  }
  return null;
}

/**
 * Selects the cheapest provider for the requested capability using
 * dynamic pricing data from `src/shared/pricing.ts`.
 * Compares the rule's configured provider and all alternatives by
 * combined input+output cost per 1k tokens, then picks the cheapest.
 * @param rule - Cost optimization rule.
 * @param request - Request context.
 * @returns Decision for the cheapest provider, or null.
 */
function evaluateCostOptimize(rule: RoutingRule, request: RequestContext): RoutingDecision | null {
  const model = rule.model || request.originalModel;

  // Build candidate list from rule + alternatives
  const candidates: { provider: string; model: string; costPer1k: number }[] = [];

  if (rule.provider) {
    const pricing = getPricing(rule.model || request.originalModel);
    const costPer1k = pricing ? (pricing.inputPerToken + pricing.outputPerToken) * 1000 : Infinity;
    candidates.push({ provider: rule.provider, model, costPer1k });
  }

  for (const alt of rule.alternatives || []) {
    const altPricing = getPricing(alt.model || model);
    const costPer1k = altPricing ? (altPricing.inputPerToken + altPricing.outputPerToken) * 1000 : Infinity;
    candidates.push({ provider: alt.provider, model: alt.model || model, costPer1k });
  }

  if (candidates.length === 0) return null;

  // Sort by cost and pick cheapest
  candidates.sort((a, b) => a.costPer1k - b.costPer1k);
  const cheapest = candidates[0];
  const rest = candidates.slice(1);

  return {
    selectedProvider: cheapest.provider,
    selectedModel: cheapest.model,
    fallbackUsed: false,
    ruleMatched: `cost_optimize:${rule.capability ?? "chat"}:${cheapest.provider}`,
    alternatives: rest.map((alt, index) => ({
      provider: alt.provider,
      model: alt.model,
      priority: index + 1,
    })),
  };
}

/**
 * Selects the lowest-latency provider within the configured threshold.
 * NOTE: Full dynamic latency comparison requires real-time latency tracking.
 * Current implementation follows the rule's configured provider, which should
 * be set to the lowest-latency option based on pre-measured benchmarks.
 * @param rule - Latency optimization rule.
 * @param request - Request context.
 * @returns Decision for the lowest-latency configured provider, or null.
 */
function evaluateLatencyOptimize(rule: RoutingRule, request: RequestContext): RoutingDecision | null {
  if (rule.provider) {
    return {
      selectedProvider: rule.provider,
      selectedModel: rule.model || request.originalModel,
      fallbackUsed: false,
      ruleMatched: `latency_optimize:${rule.capability ?? "chat"}`,
      alternatives: (rule.alternatives || []).map((alt, index) => ({ ...alt, priority: index + 1 })),
    };
  }
  return null;
}

/**
 * Matches fallback chain rules and returns the first provider in the chain.
 * @param rule - Fallback chain rule.
 * @param request - Request context.
 * @returns Decision with the first provider in the chain if model matches.
 */
function evaluateFallbackChain(rule: RoutingRule, request: RequestContext): RoutingDecision | null {
  if (!rule.chain || rule.chain.length === 0) return null;

  const matchesModel = rule.models
    ? rule.models.includes(request.originalModel)
    : true;

  if (!matchesModel) return null;

  const first = rule.chain[0];
  return {
    selectedProvider: first.provider,
    selectedModel: first.model,
    fallbackUsed: false,
    ruleMatched: `fallback_chain:${rule.models?.join(",") ?? "all"}`,
    alternatives: rule.chain.slice(1).map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      priority: rule.priority,
    })),
  };
}
