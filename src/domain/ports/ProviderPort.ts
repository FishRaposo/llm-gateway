/** Provider port - interface for LLM provider adapters.
 * Domain defines the contract, infrastructure implements it.
 */

import type { ChatResponse, StreamChunk } from "../models/Response";

export interface ProviderRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderPort {
  readonly name: string;

  complete(request: ProviderRequest): Promise<ChatResponse>;

  streamComplete(request: ProviderRequest): AsyncIterable<StreamChunk>;

  healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    errorRate: number;
  }>;

  getModelInfo(model: string): {
    id: string;
    name: string;
    contextWindow: number;
    inputPrice: number;
    outputPrice: number;
  };
}
