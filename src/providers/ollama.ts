/** Ollama local LLM provider adapter. */

import { BaseProvider } from "./base";
import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "../types/provider";
import { getModelInfo as getSharedModelInfo } from "../shared/pricing";
import { v4 as uuidv4 } from "uuid";

export class OllamaProvider extends BaseProvider {
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 128,
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.normalizeResponse(data, request.model);
  }

  async *streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 128,
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama streaming error ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Ollama streaming: no response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed) as Record<string, unknown>;
          const message = chunk.message as Record<string, unknown> | undefined;
          if (message && typeof message.content === "string") {
            yield {
              id: `ollama-${uuidv4()}`,
              model: request.model,
              provider: "ollama",
              choices: [{
                index: 0,
                message: {
                  role: (message.role as "assistant" | "user" | "system") || "assistant",
                  content: message.content,
                },
                finishReason: chunk.done ? "stop" : null,
              }],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            };
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const latencyMs = Date.now() - start;
      return {
        status: response.ok ? "healthy" : "unhealthy",
        latencyMs,
        errorRate: 0,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    } catch {
      return {
        status: "unhealthy",
        latencyMs: 0,
        errorRate: 1,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 1,
      };
    }
  }

  getModelInfo(model: string): ModelInfo {
    return (
      getSharedModelInfo(model) ?? {
        name: model,
        provider: "ollama",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        pricing: { inputPerToken: 0, outputPerToken: 0 },
        capabilities: ["chat", "streaming"],
      }
    );
  }

  private normalizeResponse(data: Record<string, unknown>, model: string): ProviderResponse {
    const message = data.message as Record<string, unknown> | undefined;
    const content = (message?.content as string) ?? "";
    const usage = data.prompt_eval_count !== undefined
      ? {
          promptTokens: (data.prompt_eval_count as number) ?? 0,
          completionTokens: (data.eval_count as number) ?? 0,
          totalTokens: ((data.prompt_eval_count as number) ?? 0) + ((data.eval_count as number) ?? 0),
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    return {
      id: `ollama-${uuidv4()}`,
      model,
      provider: "ollama",
      choices: [{
        index: 0,
        message: {
          role: (message?.role as "assistant" | "user" | "system") || "assistant",
          content,
        },
        finishReason: data.done ? "stop" : "length",
      }],
      usage,
    };
  }
}
