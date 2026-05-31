/** Provider type definitions. */

export interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderResponse {
  id: string;
  model: string;
  provider: string;
  choices: ProviderChoice[];
  usage: ProviderUsage;
  raw?: unknown;
}

export interface ProviderChoice {
  index: number;
  message: ProviderMessage;
  finishReason: string | null;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelInfo {
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  capabilities: ModelCapability[];
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}

export type ModelCapability = "chat" | "streaming" | "function_calling" | "vision" | "json_mode";

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  errorRate: number;
  lastCheck: string;
  consecutiveFailures: number;
}

export interface ProviderError {
  type: "rate_limit" | "authentication" | "timeout" | "server_error" | "invalid_request" | "unknown";
  code: number;
  message: string;
  retryable: boolean;
  provider: string;
}
