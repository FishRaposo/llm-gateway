/** Google Gemini provider adapter using the REST generateContent API. */

import { BaseProvider } from "./base";
import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "../types/provider";
import { getModelInfo as getSharedModelInfo } from "../shared/pricing";
import { providerErrorFromStatus } from "./errors";
import { v4 as uuidv4 } from "uuid";

export class GeminiProvider extends BaseProvider {
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const contents = this.translateMessages(request.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens || 1024,
        temperature: request.temperature ?? 0.7,
      },
    };

    const model = request.model.startsWith("models/")
      ? request.model
      : `models/${request.model}`;

    const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw providerErrorFromStatus(response.status, `Gemini API error ${response.status}: ${text}`, "gemini");
    }

    const data = await response.json() as Record<string, unknown>;
    return this.normalizeResponse(data, request.model);
  }

  async *streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse> {
    const contents = this.translateMessages(request.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens || 1024,
        temperature: request.temperature ?? 0.7,
      },
    };

    const model = request.model.startsWith("models/")
      ? request.model
      : `models/${request.model}`;

    const url = `${this.baseUrl}/${model}:streamGenerateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw providerErrorFromStatus(response.status, `Gemini streaming error ${response.status}: ${text}`, "gemini");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Gemini streaming: no response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("[")) continue;
        try {
          const chunk = JSON.parse(trimmed) as Record<string, unknown>;
          const candidates = chunk.candidates as Array<Record<string, unknown>> | undefined;
          if (candidates && candidates.length > 0) {
            const content = candidates[0].content as Record<string, unknown> | undefined;
            const parts = content?.parts as Array<{ text?: string }> | undefined;
            const text = parts?.map((p) => p.text).join("") ?? "";
            completionTokens += text.split(/\s+/).length || 1;
            yield {
              id: `gemini-${uuidv4()}`,
              model: request.model,
              provider: "gemini",
              choices: [{
                index: 0,
                message: { role: "assistant", content: text },
                finishReason: candidates[0].finishReason as string ?? null,
              }],
              usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
            };
          }
          const usage = chunk.usageMetadata as Record<string, number> | undefined;
          if (usage) {
            promptTokens = usage.promptTokenCount ?? promptTokens;
            completionTokens = usage.candidatesTokenCount ?? completionTokens;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const url = `${this.baseUrl}/models?key=${this.apiKey}&pageSize=1`;
      const start = Date.now();
      const response = await fetch(url, { method: "GET" });
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
        provider: "gemini",
        contextWindow: 2000000,
        maxOutputTokens: 8192,
        pricing: { inputPerToken: 0.00000125, outputPerToken: 0.000005 },
        capabilities: ["chat", "streaming", "function_calling", "vision", "json_mode"],
      }
    );
  }

  private translateMessages(
    messages: Array<{ role: string; content: string }>
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));
  }

  private normalizeResponse(data: Record<string, unknown>, model: string): ProviderResponse {
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    const candidate = candidates?.[0];
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<{ text?: string }> | undefined;
    const text = parts?.map((p) => p.text).join("") ?? "";
    const usage = data.usageMetadata as Record<string, number> | undefined;

    return {
      id: `gemini-${uuidv4()}`,
      model,
      provider: "gemini",
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finishReason: candidate?.finishReason as string ?? "stop",
      }],
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0),
      },
    };
  }
}
