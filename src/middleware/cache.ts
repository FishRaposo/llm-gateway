/** Caching middleware for storing and retrieving LLM responses. */

import { createHash } from "crypto";
import type { Response } from "express";
import type { RequestContext } from "../types/routing";
import type { ProviderRequest, ProviderResponse } from "../types/provider";
import type { MiddlewareFunction } from "../proxy/handler";
import type { CacheStore } from "../storage/cacheStore";

/**
 * Creates a caching middleware that checks for cached responses before forwarding.
 * @param _config - Gateway configuration.
 * @param cacheStore - Cache storage backend.
 * @returns Middleware function.
 */
export function createCacheMiddleware(
  _config: import("../types").GatewayConfig,
  cacheStore: CacheStore
): MiddlewareFunction {
  return async (
    context: RequestContext,
    _cfg: import("../types").GatewayConfig,
    res?: Response
  ): Promise<RequestContext | null> => {
    if (context.stream) return context;

    const cacheKey = generateCacheKey(context);
    const cached = await cacheStore.get(cacheKey);

    if (cached && res) {
      res.locals.cacheHit = true;
      res.locals.cachedResponse = cached.response;
      res.locals.cacheKey = cacheKey;
    }

    return context;
  };
}

/**
 * Generates a deterministic cache key from the request content.
 * @param request - Request context to hash.
 * @returns Cache key string.
 */
export function generateCacheKey(request: RequestContext): string {
  const content = JSON.stringify({
    model: request.originalModel,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  });
  return `cache:${hashString(content)}`;
}

/**
 * Stores a provider response in the cache.
 * @param cacheStore - Cache storage backend.
 * @param request - The original provider request.
 * @param response - The provider response to cache.
 * @param ttlSeconds - Time-to-live in seconds.
 */
export async function storeInCache(
  cacheStore: CacheStore,
  request: ProviderRequest,
  response: ProviderResponse,
  ttlSeconds: number = 3600
): Promise<void> {
  const key = `cache:${hashString(JSON.stringify({
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  }))}`;
  await cacheStore.set(key, { response: response as unknown as Record<string, unknown>, timestamp: Date.now() }, ttlSeconds);
}

/**
 * Generates a SHA-256 hex digest of a string, truncated to 32 hex characters (128 bits)
 * for collision-resistant cache keys while keeping keys reasonably short.
 * @param str - String to hash.
 * @returns Hex hash string.
 */
function hashString(str: string): string {
  return createHash("sha256").update(str).digest("hex").slice(0, 32);
}
