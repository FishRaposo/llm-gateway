/** Authentication middleware for API key validation with persistent bcrypt hashing. */

import type { GatewayConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { MiddlewareFunction } from "../proxy/handler";
import type { ApiKeyStore, ApiKeyCreateInput } from "../storage/apiKeyStore";

/**
 * Creates an authentication middleware that validates API keys via the persistent store.
 * @param config - Gateway configuration.
 * @param store - API key storage backend.
 * @returns Middleware function.
 */
export function createAuthMiddleware(config: GatewayConfig, store: ApiKeyStore): MiddlewareFunction {
  return async (
    context: RequestContext,
    _config: GatewayConfig
  ): Promise<RequestContext | null> => {
    if (!context.apiKey) {
      throwAuthError("Missing Authorization header");
      return null;
    }

    // Bootstrap admin key (no bcrypt for hardcoded admin key — store it if not present)
    if (context.apiKey === config.gatewayApiKey) {
      context.apiKeyName = "admin";
      context.apiKeyId = "admin";
      context.permissions = ["*"];
      return context;
    }

    const result = await store.validate(context.apiKey);
    if (!result.valid || !result.record) {
      throwAuthError("Invalid API key");
      return null;
    }

    context.apiKeyName = result.record.name;
    context.apiKeyId = result.record.id;
    context.permissions = result.record.permissions;
    return context;
  };
}

/**
 * Validates an API key against the persistent store.
 * @param store - API key storage backend.
 * @param apiKey - The API key to validate.
 * @returns True if the key is valid.
 */
export async function validateApiKey(store: ApiKeyStore, apiKey: string): Promise<boolean> {
  const result = await store.validate(apiKey);
  return result.valid;
}

/**
 * Registers a new API key with associated permissions and budget.
 * @param store - API key storage backend.
 * @param input - Key creation parameters.
 * @returns Created key (plaintext shown once) and record.
 */
export async function registerApiKey(
  store: ApiKeyStore,
  input: ApiKeyCreateInput
): Promise<{ id: string; apiKey: string; name: string; budgetUsd: number; allowedModels: string[] }> {
  const created = await store.create(input);
  return {
    id: created.record.id,
    apiKey: created.apiKey,
    name: created.record.name,
    budgetUsd: created.record.budgetUsd,
    allowedModels: created.record.allowedModels,
  };
}

/**
 * Revokes an API key by its record id.
 * @param store - API key storage backend.
 * @param id - The record id to revoke.
 * @returns True if a key was revoked.
 */
export async function revokeApiKey(store: ApiKeyStore, id: string): Promise<boolean> {
  return store.revoke(id);
}

/**
 * Lists all registered API keys with masked key for display.
 * @param store - API key storage backend.
 * @returns Array of key info objects with masked key.
 */
export async function listApiKeys(store: ApiKeyStore): Promise<Array<{ id: string; name: string; budgetUsd: number; allowedModels: string[] }>> {
  const records = await store.list();
  return records.map((r) => ({
    id: r.id,
    name: r.name,
    budgetUsd: r.budgetUsd,
    allowedModels: r.allowedModels,
  }));
}

/**
 * Returns a masked version of an API key for display.
 * @param key - The full API key.
 * @returns Masked key string.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return key;
  return `${key.slice(0, 8)}...`;
}

/**
 * Throws a formatted authentication error.
 * @param message - Error message.
 */
function throwAuthError(message: string): never {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 401;
  error.code = "unauthorized";
  throw error;
}
