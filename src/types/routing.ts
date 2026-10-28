/** Routing type definitions. */

export interface RequestContext {
  requestId: string;
  apiKey: string;
  apiKeyName: string;
  /** Stable record id used as the budget identifier (deduct/read/limit). */
  apiKeyId?: string;
  /**
   * Canonical account identity for accounting, cache, rate-limit, and audit
   * correlation. Set by auth to the key record id (or "admin"); never the
   * plaintext credential.
   */
  accountId?: string;
  permissions: string[];
  /** Model restrictions from the authenticated key record, enforced on routes and fallback. */
  allowedModels?: string[];
  originalModel: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  /** True while a budget reservation is held for this requestId. */
  budgetReserved?: boolean;
  /** Set when settlement occurred without measured provider usage. */
  usageUnknown?: boolean;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface GatewayResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ResponseChoice[];
  usage: ResponseUsage;
  /** Explicitly distinguishes placeholder counts from measured zero tokens. */
  usageKnown: boolean;
  /** Cached service is free; missing usage/pricing never establishes a measured zero bill. */
  costBasis: "measured" | "unknown" | "cached";
  provider: string;
  cacheHit: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface ResponseChoice {
  index: number;
  message: ChatMessage;
  finishReason: string | null;
}

export interface ResponseUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type RoutingStrategy = "model_preference" | "cost_optimize" | "latency_optimize" | "fallback_chain";

export interface RoutingDecision {
  selectedProvider: string;
  selectedModel: string;
  fallbackUsed: boolean;
  ruleMatched: string;
  alternatives: RoutingAlternative[];
}

export interface RoutingAlternative {
  provider: string;
  model: string;
  priority: number;
}
