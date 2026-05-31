/** Policy enforcement middleware for content filtering and model restrictions. */

import type { GatewayConfig, PolicyRuleConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { PolicyDecision } from "../types/policy";
import type { MiddlewareFunction } from "../proxy/handler";
import { evaluateGuardrails, toPolicyDecision } from "../guardrails";

/**
 * Creates a policy middleware that evaluates requests against configured policy rules.
 * @param config - Gateway configuration.
 * @returns Middleware function.
 */
export function createPolicyMiddleware(config: GatewayConfig): MiddlewareFunction {
  return async (
    context: RequestContext,
    _config: GatewayConfig
  ): Promise<RequestContext | null> => {
    const allContent = context.messages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join(" ");

    // Guardrails pre-check (always-on safety layer)
    const guardrails = evaluateGuardrails(allContent);
    if (!guardrails.allowed) {
      const decision = toPolicyDecision(guardrails);
      const error = new Error(decision.reason ?? "Request denied by guardrails") as Error & { statusCode: number; code: string };
      error.statusCode = 403;
      error.code = "guardrails_denied";
      throw error;
    }

    // Apply sanitization if guardrails modified the prompt
    if (guardrails.sanitized) {
      for (const msg of context.messages) {
        if (typeof msg.content === "string") {
          msg.content = guardrails.sanitized;
        }
      }
    }

    if (!config.policy.enabled || config.policy.rules.length === 0) {
      return context;
    }

    const rules = sortRulesByEvalOrder(config.policy.rules, config.policy.evalOrder);
    const decision = evaluatePolicies(context, rules);

    if (!decision.allowed) {
      const error = new Error(decision.reason ?? "Request denied by policy") as Error & { statusCode: number; code: string };
      error.statusCode = 403;
      error.code = "policy_denied";
      throw error;
    }

    return context;
  };
}

/**
 * Evaluates all policy rules against a request context.
 * @param context - The request context to evaluate.
 * @param rules - Array of policy rules to evaluate.
 * @returns Policy decision with allow/deny and optional modifications.
 */
export function evaluatePolicies(
  context: RequestContext,
  rules: PolicyRuleConfig[]
): PolicyDecision {
  for (const rule of rules) {
    const decision = evaluatePolicyRule(rule, context);
    if (!decision.allowed) {
      return decision;
    }
  }

  return { allowed: true };
}

/**
 * Evaluates a single policy rule against a request.
 * @param rule - The policy rule to evaluate.
 * @param context - The request context.
 * @returns Policy decision.
 */
function evaluatePolicyRule(rule: PolicyRuleConfig, context: RequestContext): PolicyDecision {
  switch (rule.type) {
    case "content_filter":
      return evaluateContentFilter(rule, context);
    case "model_restriction":
      return evaluateModelRestriction(rule, context);
    case "pii_detection":
      return evaluatePiiDetection(rule, context);
    case "request_modify":
      return evaluateRequestModify(rule, context);
    default:
      return { allowed: true };
  }
}

function evaluateRequestModify(rule: PolicyRuleConfig, context: RequestContext): PolicyDecision {
  if (!rule.modifications || rule.modifications.length === 0) return { allowed: true };

  for (const mod of rule.modifications) {
    if (mod.field === "max_tokens") {
      if (context.maxTokens !== undefined) {
        if (mod.max !== undefined && context.maxTokens > mod.max) {
          if (mod.onViolation === "clamp") {
            context.maxTokens = mod.max;
          } else if (mod.onViolation === "deny") {
            return {
              allowed: false,
              reason: `max_tokens ${context.maxTokens} exceeds limit ${mod.max}`,
              matchedRule: "request_modify:max_tokens",
            };
          } else if (mod.onViolation === "default" && mod.value !== undefined) {
            context.maxTokens = mod.value as number;
          }
        }
        if (mod.min !== undefined && context.maxTokens < mod.min) {
          if (mod.onViolation === "clamp") {
            context.maxTokens = mod.min;
          } else if (mod.onViolation === "deny") {
            return {
              allowed: false,
              reason: `max_tokens ${context.maxTokens} below minimum ${mod.min}`,
              matchedRule: "request_modify:max_tokens",
            };
          } else if (mod.onViolation === "default" && mod.value !== undefined) {
            context.maxTokens = mod.value as number;
          }
        }
      } else if (mod.value !== undefined) {
        context.maxTokens = mod.value as number;
      }
    } else if (mod.field === "temperature") {
      if (context.temperature !== undefined) {
        if (mod.min !== undefined && context.temperature < mod.min) {
          if (mod.onViolation === "clamp") {
            context.temperature = mod.min;
          } else if (mod.onViolation === "deny") {
            return {
              allowed: false,
              reason: `temperature ${context.temperature} below minimum ${mod.min}`,
              matchedRule: "request_modify:temperature",
            };
          } else if (mod.onViolation === "default" && mod.value !== undefined) {
            context.temperature = mod.value as number;
          }
        }
        if (mod.max !== undefined && context.temperature > mod.max) {
          if (mod.onViolation === "clamp") {
            context.temperature = mod.max;
          } else if (mod.onViolation === "deny") {
            return {
              allowed: false,
              reason: `temperature ${context.temperature} exceeds maximum ${mod.max}`,
              matchedRule: "request_modify:temperature",
            };
          } else if (mod.onViolation === "default" && mod.value !== undefined) {
            context.temperature = mod.value as number;
          }
        }
      } else if (mod.value !== undefined) {
        context.temperature = mod.value as number;
      }
    }
  }

  return { allowed: true };
}

function sortRulesByEvalOrder(rules: PolicyRuleConfig[], evalOrder: string[]): PolicyRuleConfig[] {
  if (!evalOrder || evalOrder.length === 0) return rules;

  const sorted = [...rules];
  sorted.sort((a, b) => {
    const ia = evalOrder.indexOf(a.type);
    const ib = evalOrder.indexOf(b.type);
    const indexA = ia === -1 ? evalOrder.length : ia;
    const indexB = ib === -1 ? evalOrder.length : ib;
    return indexA - indexB;
  });
  return sorted;
}

/**
 * Checks request content against blocked patterns.
 * @param rule - Content filter rule with patterns.
 * @param context - Request with messages to check.
 * @returns Policy decision.
 */
function evaluateContentFilter(rule: PolicyRuleConfig, context: RequestContext): PolicyDecision {
  if (!rule.patterns || rule.patterns.length === 0) return { allowed: true };

  const allContent = context.messages.map((m) => m.content).join(" ");
  const contentToCheck = rule.caseSensitive ? allContent : allContent.toLowerCase();

  for (const pattern of rule.patterns) {
    const patternToCheck = rule.caseSensitive ? pattern : pattern.toLowerCase();
    if (contentToCheck.includes(patternToCheck)) {
      return {
        allowed: false,
        reason: `Content filter matched pattern: "${pattern}"`,
        matchedRule: `content_filter:${pattern}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Checks if the requested model is allowed or blocked.
 * @param rule - Model restriction rule.
 * @param context - Request with model name.
 * @returns Policy decision.
 */
function evaluateModelRestriction(rule: PolicyRuleConfig, context: RequestContext): PolicyDecision {
  if (rule.blockedModels && rule.blockedModels.includes(context.originalModel)) {
    return {
      allowed: false,
      reason: `Model "${context.originalModel}" is blocked by policy`,
      matchedRule: "model_restriction:blocked",
    };
  }

  if (rule.allowedModels && rule.allowedModels.length > 0) {
    if (!rule.allowedModels.includes(context.originalModel)) {
      return {
        allowed: false,
        reason: `Model "${context.originalModel}" is not in the allowed list`,
        matchedRule: "model_restriction:allowed",
      };
    }
  }

  return { allowed: true };
}

/**
 * Checks for potential PII in request content using pattern matching.
 * @param rule - PII detection rule.
 * @param context - Request with messages.
 * @returns Policy decision.
 */
function evaluatePiiDetection(rule: PolicyRuleConfig, context: RequestContext): PolicyDecision {
  if (!rule.detect || rule.detect.length === 0) return { allowed: true };

  const allContent = context.messages.map((m) => m.content).join(" ");

  const piiPatterns: Record<string, RegExp> = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    credit_card: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
    ip_address: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  };

  for (const type of rule.detect) {
    const pattern = piiPatterns[type];
    if (pattern && pattern.test(allContent)) {
      return {
        allowed: false,
        reason: `Potential PII detected: ${type}`,
        matchedRule: `pii_detection:${type}`,
      };
    }
  }

  return { allowed: true };
}
