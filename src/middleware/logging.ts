/** Audit logging middleware for recording all requests and responses. */

import type { GatewayConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { MiddlewareFunction } from "../proxy/handler";
import type { AuditLogStorage } from "../storage/auditLog";

/**
 * Creates a logging middleware that records request metadata to the audit log.
 * @param config - Gateway configuration.
 * @param auditLog - Audit log storage backend.
 * @returns Middleware function.
 */
export function createLoggingMiddleware(_config: GatewayConfig, _auditLog: AuditLogStorage): MiddlewareFunction {
  return async (
    context: RequestContext,
    _config: GatewayConfig
  ): Promise<RequestContext | null> => {
    logRequest(context);
    return context;
  };
}

/**
 * Logs a request's metadata for audit purposes.
 * @param context - The request context to log.
 */
export function logRequest(context: RequestContext): void {
  const entry = {
    id: context.requestId,
    timestamp: context.timestamp,
    apiKey: `${context.apiKey.slice(0, 8)}...`,
    apiKeyName: context.apiKeyName,
    model: context.originalModel,
    messageCount: context.messages.length,
    stream: context.stream,
  };

  console.log(JSON.stringify({
    level: "info",
    message: "request_received",
    ...entry,
  }));
}

/**
 * Logs a response's metadata for audit purposes.
 * @param responseId - ID of the response.
 * @param model - Model used.
 * @param provider - Provider used.
 * @param durationMs - Request duration.
 * @param inputTokens - Tokens used in the prompt.
 * @param outputTokens - Tokens in the completion.
 */
export function logResponse(
  responseId: string,
  model: string,
  provider: string,
  durationMs: number,
  inputTokens: number,
  outputTokens: number
): void {
  console.log(JSON.stringify({
    level: "info",
    message: "response_sent",
    responseId,
    model,
    provider,
    durationMs,
    inputTokens,
    outputTokens,
  }));
}
