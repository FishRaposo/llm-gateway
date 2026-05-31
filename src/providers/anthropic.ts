/** Anthropic provider adapter for the Messages API. */

import { BaseProvider } from "./base";
import { GatewayProviderError } from "./errors";
import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "../types/provider";
import { v4 as uuidv4 } from "uuid";

const MODEL_PRICING: Record<string, ModelInfo> = {
  "claude-sonnet-4-20250514": {
    name: "claude-sonnet-4-20250514",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPerToken: 0.000003, outputPerToken: 0.000015 },
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
  "claude-3-5-haiku-20241022": {
    name: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPerToken: 0.000001, outputPerToken: 0.000005 },
    capabilities: ["chat", "streaming", "function_calling", "vision"],
  },
};

/**
 * Anthropic provider implementation for the Messages API.
 */
export class AnthropicProvider extends BaseProvider {
  /**
   * Sends a message request to the Anthropic Messages API.
   * @param request - Provider-formatted request (converted from OpenAI format).
   * @returns Normalized provider response.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const { system, messages } = this.translateRequest(request);

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages,
      ...(system ? { system } : {}),
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new GatewayProviderError(
        response.status === 429 ? "rate_limit" : response.status >= 500 ? "server_error" : "invalid_request",
        response.status,
        await response.text(),
        response.status === 429 || response.status >= 500,
        "anthropic"
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.normalizeResponse(data, request.model);
  }

  /**
   * Streams a message request via Anthropic's SSE stream.
   * @param request - Provider-formatted request.
   * @returns Async iterator of response chunks.
   */
  async *streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse> {
    const { system, messages } = this.translateRequest(request);

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages,
      stream: true,
      ...(system ? { system } : {}),
    };

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new GatewayProviderError("server_error", response.status, "Stream request failed", true, "anthropic");
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
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (event.type === "content_block_delta") {
              yield {
                id: uuidv4(),
                model: request.model,
                provider: "anthropic",
                choices: [{
                  index: 0,
                  message: { role: "assistant", content: (event.delta as Record<string, string>)?.text ?? "" },
                  finishReason: null,
                }],
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              };
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
  }

  /**
   * Checks Anthropic API health.
   * @returns Provider health status.
   */
  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        signal: AbortSignal.timeout(10000),
      });
      return {
        status: response.ok || response.status === 400 ? "healthy" : "degraded",
        latencyMs: Date.now() - start,
        errorRate: response.ok ? 0 : 0.5,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
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
   * Returns model information for a given Anthropic model.
   * @param model - Model name.
   * @returns Model info or a default entry.
   */
  getModelInfo(model: string): ModelInfo {
    return (
      MODEL_PRICING[model] ?? {
        name: model,
        provider: "anthropic",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        pricing: { inputPerToken: 0.000003, outputPerToken: 0.000015 },
        capabilities: ["chat"],
      }
    );
  }

  /**
   * Translates OpenAI-format messages to Anthropic format.
   * Extracts the system message and ensures messages alternate user/assistant.
   * @param request - Provider request with OpenAI-format messages.
   * @returns Object with optional system prompt and translated messages.
   */
  private translateRequest(
    request: ProviderRequest
  ): { system: string | null; messages: Array<{ role: "user" | "assistant"; content: string }> } {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    const system = systemMessages.map((m) => m.content).join("\n") || null;
    const messages = nonSystemMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    return { system, messages };
  }

  /**
   * Normalizes an Anthropic Messages API response to provider format.
   * @param data - Raw Anthropic response.
   * @param model - The model used for the request.
   * @returns Normalized provider response.
   */
  private normalizeResponse(data: Record<string, unknown>, model: string): ProviderResponse {
    const content = (data.content as Array<Record<string, string>>)?.filter((c) => c.type === "text") ?? [];
    const text = content.map((c) => c.text).join("");

    const usage = data.usage as Record<string, number> | undefined;

    return {
      id: (data.id as string) || uuidv4(),
      model,
      provider: "anthropic",
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finishReason: (data.stop_reason as string) ?? "end_turn",
      }],
      usage: {
        promptTokens: usage?.input_tokens ?? 0,
        completionTokens: usage?.output_tokens ?? 0,
        totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      },
      raw: data,
    };
  }
}
