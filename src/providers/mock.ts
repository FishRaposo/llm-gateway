/** Mock provider for deterministic testing without real API calls. */

import { BaseProvider } from "./base";
import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "../types/provider";
import { GatewayProviderError } from "./errors";
import { v4 as uuidv4 } from "uuid";

export interface MockProviderConfig {
  defaultResponse?: string;
  latencyMs?: number;
  errorRate?: number;
}

/**
 * Mock provider that returns configurable responses for testing.
 */
export class MockProvider extends BaseProvider {
  private mockConfig: Required<MockProviderConfig>;

  constructor(config: MockProviderConfig = {}) {
    super("mock-api-key", "http://localhost:0", 1000);
    this.mockConfig = {
      defaultResponse: config.defaultResponse ?? "This is a mock response from the LLM Gateway mock provider.",
      latencyMs: config.latencyMs ?? 50,
      errorRate: config.errorRate ?? 0,
    };
  }

  /**
   * Returns a mock completion response after simulated latency.
   * @param request - Provider request (used for model name in response).
   * @returns Mock provider response.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    await this.simulateLatency();

    if (Math.random() < this.mockConfig.errorRate) {
      throw new GatewayProviderError(
        "server_error",
        500,
        "Mock provider simulated error",
        true,
        "mock"
      );
    }

    return {
      id: `mock-${uuidv4()}`,
      model: request.model,
      provider: "mock",
      choices: [{
        index: 0,
        message: { role: "assistant", content: this.mockConfig.defaultResponse! },
        finishReason: "stop",
      }],
      usage: {
        promptTokens: request.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
        completionTokens: Math.ceil(this.mockConfig.defaultResponse!.length / 4),
        totalTokens: request.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0) + Math.ceil(this.mockConfig.defaultResponse!.length / 4),
      },
    };
  }

  /**
   * Yields mock streaming chunks with simulated latency.
   * @param request - Provider request.
   * @returns Async iterator of mock chunks.
   */
  async *streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse> {
    const words = this.mockConfig.defaultResponse!.split(" ");

    for (const word of words) {
      await this.simulateLatency();
      yield {
        id: `mock-stream-${uuidv4()}`,
        model: request.model,
        provider: "mock",
        choices: [{
          index: 0,
          message: { role: "assistant", content: word + " " },
          finishReason: null,
        }],
        usage: { promptTokens: 0, completionTokens: 1, totalTokens: 1 },
      };
    }
  }

  /**
   * Always returns healthy status.
   * @returns Healthy provider status.
   */
  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      latencyMs: this.mockConfig.latencyMs ?? 0,
      errorRate: 0,
      lastCheck: new Date().toISOString(),
      consecutiveFailures: 0,
    };
  }

  /**
   * Returns mock model info.
   * @param model - Model name.
   * @returns Mock model information.
   */
  getModelInfo(model: string): ModelInfo {
    return {
      name: model,
      provider: "mock",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      pricing: { inputPerToken: 0, outputPerToken: 0 },
      capabilities: ["chat", "streaming"],
    };
  }

  /**
   * Simulates network latency.
   */
  private async simulateLatency(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.mockConfig.latencyMs));
  }
}
