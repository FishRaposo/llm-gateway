/** Provider adapter - implements ProviderPort for existing providers.
 * Infrastructure layer - wraps provider implementations with domain interface.
 */

import type { ProviderPort, ProviderRequest } from "../../domain/ports/ProviderPort";
import type { ChatResponse, StreamChunk } from "../../domain/models/Response";
import type { BaseProvider } from "../../providers/base";

export class ProviderAdapter implements ProviderPort {
  constructor(
    public readonly name: string,
    private provider: BaseProvider
  ) {}

  async complete(request: ProviderRequest): Promise<ChatResponse> {
    const infraRequest = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stream: false,
      metadata: request.metadata,
    };

    const response = await this.provider.complete(infraRequest);

    return {
      id: response.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: response.choices.map((c) => ({
        index: c.index,
        message: {
          role: "assistant" as const,
          content: c.message.content,
        },
        finishReason: c.finishReason ?? "stop",
      })),
      usage: {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
      },
      provider: this.name,
      cacheHit: false,
      fallbackUsed: false,
      latencyMs: 0,
    };
  }

  async *streamComplete(
    request: ProviderRequest
  ): AsyncIterable<StreamChunk> {
    const infraRequest = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stream: true,
      metadata: request.metadata,
    };

    for await (const chunk of this.provider.streamComplete(infraRequest)) {
      yield {
        id: chunk.id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: chunk.model,
        choices: chunk.choices.map((c) => ({
          index: c.index,
          delta: {
            role: c.message?.role === "assistant" ? "assistant" as const : undefined,
            content: c.message?.content,
          },
          finishReason: c.finishReason,
        })),
      };
    }
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    errorRate: number;
  }> {
    const health = await this.provider.healthCheck();
    return {
      healthy: health.status === "healthy",
      latencyMs: health.latencyMs,
      errorRate: health.errorRate,
    };
  }

  getModelInfo(_model: string): {
    id: string;
    name: string;
    contextWindow: number;
    inputPrice: number;
    outputPrice: number;
  } {
    const info = this.provider.getModelInfo(_model);
    return {
      id: info.name,
      name: info.name,
      contextWindow: info.contextWindow,
      inputPrice: info.pricing.inputPerToken,
      outputPrice: info.pricing.outputPerToken,
    };
  }
}
