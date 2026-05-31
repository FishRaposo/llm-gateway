/** Authentication middleware for API key validation. */

import type { GatewayConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { MiddlewareFunction } from "../proxy/handler";

const VALID_KEYS = new Map<string, { name: string; permissions: string[]; budgetUsd: number }>();

/**
 * Creates an authentication middleware that validates API keys.
 * @param config - Gateway configuration.
 * @returns Middleware function.
 */
export function createAuthMiddleware(config: GatewayConfig): MiddlewareFunction {
  VALID_KEYS.set(config.gatewayApiKey, {
    name: "admin",
    permissions: ["*"],
    budgetUsd: Infinity,
  });

  return async (
    context: RequestContext,
    _config: GatewayConfig
  ): Promise<RequestContext | null> => {
    if (!context.apiKey) {
      throwAuthError("Missing Authorization header");
      return null;
    }

    const keyInfo = VALID_KEYS.get(context.apiKey);
    if (!keyInfo) {
      throwAuthError("Invalid API key");
      return null;
    }

    context.apiKeyName = keyInfo.name;
    return context;
  };
}

/**
 * Validates an API key against the known keys.
 * @param apiKey - The API key to validate.
 * @returns True if the key is valid.
 */
export function validateApiKey(apiKey: string): boolean {
  return VALID_KEYS.has(apiKey);
}

/**
 * Registers a new API key with associated permissions and budget.
 * @param apiKey - The API key to register.
 * @param name - Human-readable name for the key.
 * @param permissions - Array of permission strings.
 * @param budgetUsd - Budget limit in USD.
 */
export function registerApiKey(
  apiKey: string,
  name: string,
  permissions: string[] = ["chat"],
  budgetUsd: number = 100
): void {
  VALID_KEYS.set(apiKey, { name, permissions, budgetUsd });
}

/**
 * Revokes an API key.
 * @param apiKey - The API key to revoke.
 */
export function revokeApiKey(apiKey: string): void {
  VALID_KEYS.delete(apiKey);
}

/**
 * Lists all registered API keys with full key for internal use and masked key for display.
 * @returns Array of key info objects with full and masked keys.
 */
export function listApiKeys(): Array<{ key: string; name: string; budgetUsd: number }> {
  return Array.from(VALID_KEYS.entries()).map(([key, info]) => ({
    key,
    name: info.name,
    budgetUsd: info.budgetUsd,
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
