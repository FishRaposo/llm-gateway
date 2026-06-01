/** OpenAI provider adapter for chat completions. */

import { BaseProvider } from "./base";
import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth, ProviderError } from "../types/provider";
import { getModelInfo as getSharedModelInfo } from "../shared/pricing";
import { v4 as uuidv4 } from "uuid";
import { GatewayProviderError } from "./errors";

/**
 * OpenAI provider implementation for the chat completions API.
 */
export class OpenAIProvider extends BaseProvider {
  /**
   * Sends a chat completion request to the OpenAI API.
   * @param request - Provider-formatted request.
   * @returns Normalized provider response.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: false,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw this.handleError(response.status, await response.text());
    }

    const data = await response.json() as Record<string, unknown>;
    return this.normalizeResponse(data);
  }

  /**
   * Streams a chat completion request via SSE.
   * @param request - Provider-formatted request.
   * @returns Async iterator of response chunks.
   */
  async *streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw this.handleError(response.status, await response.text());
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          const chunk = JSON.parse(line.slice(6)) as Record<string, unknown>;
          yield this.normalizeStreamChunk(chunk);
        }
      }
    }
  }

  /**
   * Checks OpenAI API health by making a lightweight request.
   * @returns Provider health status.
   */
  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: response.ok ? "healthy" : "degraded",
        latencyMs: Date.now() - start,
        errorRate: 0,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: response.ok ? 0 : 1,
      };
    } catch {
      return {
        status: "unhealthy",
        latencyMs: Date.now() - start,
        errorRate: 1,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 1,
      };
    }
  }

  /**
   * Returns model information for a given OpenAI model.
   * @param model - Model name.
   * @returns Model info or a default entry.
   */
  getModelInfo(model: string): ModelInfo {
    return (
      getSharedModelInfo(model) ?? {
        name: model,
        provider: "openai",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        pricing: { inputPerToken: 0.000001, outputPerToken: 0.000002 },
        capabilities: ["chat"],
      }
    );
  }

  /**
   * Normalizes an OpenAI API response to the provider response format.
   * @param data - Raw OpenAI response data.
   * @returns Normalized provider response.
   */
  private normalizeResponse(data: Record<string, unknown>): ProviderResponse {
    const choices = (data.choices as Array<Record<string, unknown>>)?.map((choice, index) => ({
      index,
      message: {
        role: (choice.message as Record<string, string>)?.role as "assistant",
        content: (choice.message as Record<string, string>)?.content ?? "",
      },
      finishReason: (choice.finish_reason as string) ?? "stop",
    })) ?? [];

    const usage = data.usage as Record<string, number> | undefined;

    return {
      id: (data.id as string) || uuidv4(),
      model: (data.model as string) || "unknown",
      provider: "openai",
      choices,
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      raw: data,
    };
  }

  /**
   * Normalizes a streaming chunk from OpenAI.
   * @param chunk - Raw streaming chunk.
   * @returns Partial provider response.
   */
  private normalizeStreamChunk(chunk: Record<string, unknown>): ProviderResponse {
    const choices = (chunk.choices as Array<Record<string, unknown>>)?.map((choice, index) => ({
      index,
      message: {
        role: "assistant" as const,
        content: ((choice.delta as Record<string, string>)?.content) ?? "",
      },
      finishReason: (choice.finish_reason as string) ?? null,
    })) ?? [];

    return {
      id: (chunk.id as string) || uuidv4(),
      model: (chunk.model as string) || "unknown",
      provider: "openai",
      choices,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      raw: chunk,
    };
  }

  /**
   * Maps an HTTP status code to a typed provider error.
   * @param status - HTTP status code.
   * @param body - Response body text.
   * @returns Typed provider error.
   */
  private handleError(status: number, body: string): GatewayProviderError {
    const typeMap: Record<number, ProviderError["type"]> = {
      401: "authentication",
      429: "rate_limit",
      504: "timeout",
    };

    return new GatewayProviderError(
      typeMap[status] || (status >= 500 ? "server_error" : "invalid_request"),
      status,
      body.slice(0, 500),
      status === 429 || status >= 500,
      "openai"
    );
  }
}
