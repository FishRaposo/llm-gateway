/** Routing type definitions. */

export interface RequestContext {
  requestId: string;
  apiKey: string;
  apiKeyName: string;
  permissions: string[];
  originalModel: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
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
