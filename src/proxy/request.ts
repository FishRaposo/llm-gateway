/** Request parsing and transformation utilities. */

import type { Request } from "express";
import type { RequestContext, GatewayResponse, RoutingDecision } from "../types/routing";
import type { ProviderRequest, ProviderResponse } from "../types/provider";
import { v4 as uuidv4 } from "uuid";

/**
 * Parses and validates an incoming Express request into a RequestContext.
 * @param req - Express request object.
 * @returns Validated RequestContext.
 * @throws Error if request format is invalid.
 */
export function parseRequest(req: Request): RequestContext {
  const body = req.body;

  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }

  for (const msg of body.messages) {
    if (!msg.role || typeof msg.content !== "string") {
      throw new Error("Each message must have a 'role' and 'content' string");
    }
  }

  const authHeader = req.headers.authorization || "";
  const apiKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  return {
    requestId: uuidv4(),
    apiKey,
    apiKeyName: "default",
    originalModel: body.model || "gpt-4o-mini",
    messages: body.messages.map((m: { role: string; content: string }) => ({
      role: m.role as "system" | "user" | "assistant" | "tool",
      content: m.content,
    })),
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    stream: Boolean(body.stream),
    metadata: {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Transforms a RequestContext and routing decision into a provider-specific request.
 * @param context - Processed request context.
 * @param decision - Routing decision with selected provider and model.
 * @returns Provider-formatted request.
 */
export function buildProviderRequest(
  context: RequestContext,
  decision: RoutingDecision
): ProviderRequest {
  return {
    model: decision.selectedModel,
    messages: context.messages
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
    temperature: context.temperature,
    maxTokens: context.maxTokens,
    stream: context.stream,
    metadata: context.metadata,
  };
}

/**
 * Normalizes a provider response into the gateway's OpenAI-compatible format.
 * @param providerResponse - Raw response from the provider.
 * @param decision - Routing decision that was applied.
 * @param startTime - Request start timestamp for latency calculation.
 * @returns OpenAI-compatible GatewayResponse.
 */
export function parseProviderResponse(
  providerResponse: ProviderResponse,
  decision: RoutingDecision,
  startTime: number
): GatewayResponse {
  return {
    id: providerResponse.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: providerResponse.model,
    choices: providerResponse.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: choice.message.role,
        content: choice.message.content,
      },
      finishReason: choice.finishReason,
    })),
    usage: {
      promptTokens: providerResponse.usage.promptTokens,
      completionTokens: providerResponse.usage.completionTokens,
      totalTokens: providerResponse.usage.totalTokens,
    },
    provider: providerResponse.provider,
    cacheHit: false,
    fallbackUsed: decision.fallbackUsed,
    latencyMs: Date.now() - startTime,
  };
}
