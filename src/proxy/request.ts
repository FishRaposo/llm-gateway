/** Request parsing and transformation utilities. */

import type { Request } from "express";
import type { RequestContext, GatewayResponse, RoutingDecision } from "../types/routing";
import type { ProviderRequest, ProviderResponse } from "../types/provider";
import { v4 as uuidv4 } from "uuid";
import { isValidUsage, normalizeUsage } from "../providers/usage";
import { getPricing } from "../shared/pricing";

const VALID_MESSAGE_ROLES = new Set(["system", "user", "assistant"]);
const UNFORWARDED_ROLES = new Set(["tool", "function"]);

// Generous bound above every cataloged model's maxOutputTokens; finer limits
// belong to policy rules. Keeps absurd values from distorting reservations.
const MAX_TOKENS_HARD_LIMIT = 131_072;

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

  if (body.messages.length > 100) {
    throw new Error("messages array exceeds maximum of 100 items");
  }

  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object" || typeof msg.role !== "string" || typeof msg.content !== "string") {
      throw new Error("Each message must have a 'role' and 'content' string");
    }
    if (UNFORWARDED_ROLES.has(msg.role)) {
      throw new Error(`Unsupported message role "${msg.role}": tool/function call results are not forwarded`);
    }
    if (!VALID_MESSAGE_ROLES.has(msg.role)) {
      throw new Error(`Unsupported message role "${msg.role}"`);
    }
    if (msg.content.length > 100_000) {
      throw new Error("Each message 'content' must not exceed 100KB");
    }
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    throw new Error("model must be a string");
  }
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || !Number.isFinite(body.temperature) || body.temperature < 0) {
      throw new Error("temperature must be a nonnegative finite number");
    }
  }
  if (body.max_tokens !== undefined) {
    if (typeof body.max_tokens !== "number" || !Number.isInteger(body.max_tokens) || body.max_tokens < 0) {
      throw new Error("max_tokens must be a nonnegative integer");
    }
    if (body.max_tokens > MAX_TOKENS_HARD_LIMIT) {
      throw new Error(`max_tokens must not exceed ${MAX_TOKENS_HARD_LIMIT}`);
    }
  }

  const systemMsg = body.messages.find((m: { role: string }) => m.role === "system");
  if (systemMsg && systemMsg.content.length > 10_000) {
    throw new Error("System message content must not exceed 10KB");
  }

  const authHeader = req.headers.authorization || "";
  const apiKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  // Correlation headers do not deduplicate provider calls. Each dispatched
  // attempt therefore needs a server-generated accounting identity; otherwise
  // clients could reuse an id while incurring new spend that settles only once.
  const clientRequestId =
    (req.headers["idempotency-key"] as string | undefined) ??
    (req.headers["x-request-id"] as string | undefined);
  const requestId = uuidv4();

  return {
    requestId,
    apiKey,
    apiKeyName: "default",
    permissions: [],
    originalModel: body.model || "gpt-4o-mini",
    messages: body.messages.map((m: { role: string; content: string }) => ({
      role: m.role as "system" | "user" | "assistant" | "tool",
      content: m.content,
    })),
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    stream: Boolean(body.stream),
    metadata: {
      clientRequestId: clientRequestId && clientRequestId.length <= 128 ? clientRequestId : undefined,
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
    messages: context.messages.map((m) => ({
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
  const usageKnown = providerResponse.usageKnown !== false && isValidUsage(providerResponse.usage);
  const usage = usageKnown ? providerResponse.usage : normalizeUsage(undefined, undefined, undefined).usage;
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
    usage,
    usageKnown,
    costBasis: usageKnown && getPricing(providerResponse.model) !== null ? "measured" : "unknown",
    provider: providerResponse.provider,
    cacheHit: false,
    fallbackUsed: decision.fallbackUsed,
    latencyMs: Date.now() - startTime,
  };
}
