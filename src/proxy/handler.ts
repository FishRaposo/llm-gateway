/** Main proxy handler that orchestrates request processing through the middleware chain. */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { GatewayConfig, AuditEntry } from "../types";
import type { RequestContext, GatewayResponse } from "../types/routing";
import type { ProviderResponse } from "../types/provider";
import { parseRequest, buildProviderRequest, parseProviderResponse } from "./request";
import { logResponse } from "../middleware/logging";
import { Router } from "../routing/router";
import { handleFallback } from "../routing/fallback";
import { getProvider } from "../providers/registry";
import { generateCacheKey } from "../middleware/cache";
import { calculateCost } from "../shared/pricing";
import { handleStreamingRequest } from "./streaming";
import { recordGatewayError, recordGatewayRequest } from "../metrics";

/** Surfaces lifecycle/accounting failures as metrics + logs instead of silent drops. */
function reportLifecycleError(stage: "settle" | "release" | "audit", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", message: `Budget/audit ${stage} failure`, error: message }));
  recordGatewayError(`${stage}_failure`);
}

export type MiddlewareFunction = (
  context: RequestContext,
  config: GatewayConfig,
  res?: Response
) => Promise<RequestContext | null>;

export interface StorageInstances {
  auditLog: import("../storage/auditLog").AuditLogStorage;
  cacheStore: import("../storage/cacheStore").CacheStore;
  budgetTracker: import("../storage/budgetTracker").BudgetTracker;
  apiKeyStore: import("../storage/apiKeyStore").ApiKeyStore;
}

/**
 * Processes an incoming request through the full middleware chain.
 * @param req - Express request object.
 * @param res - Express response object.
 * @param middlewareChain - Ordered array of middleware functions.
 * @param storage - Storage backend instances.
 * @param config - Gateway configuration.
 */
export async function handleRequest(
  req: Request,
  res: Response,
  middlewareChain: MiddlewareFunction[],
  storage: StorageInstances,
  config: GatewayConfig
): Promise<void> {
  const startTime = Date.now();
  let context: RequestContext | undefined;

  try {
    context = parseRequest(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request format";
    recordGatewayError("invalid_request");
    res.status(400).json({
      error: { message, type: "invalid_request_error", code: "invalid_request" },
    });
    return;
  }

  try {
    for (const middleware of middlewareChain) {
      if (!context) return;
      const result = await middleware(context, config, res);
      if (result === null) {
        return;
      }
      context = result;
    }

    if (context.stream) {
      const router = new Router(config.routing);
      const decision = router.route(context);
      const providerRequest = buildProviderRequest(context, decision);
      await handleStreamingRequest(req, res, context, providerRequest, decision.selectedProvider, config, decision, storage);
      return;
    }

    if (res.locals.cacheHit) {
      // No provider spend occurred — release the reservation rather than settle.
      if (context.budgetReserved) {
        await storage.budgetTracker
          .release(context.accountId ?? context.apiKeyId ?? context.apiKey, context.requestId)
          .catch((e) => reportLifecycleError("release", e));
        context.budgetReserved = false;
      }

      const cachedData = res.locals.cachedResponse as Record<string, unknown>;
      const providerResponse = cachedData as unknown as ProviderResponse;
      const gatewayResponse: GatewayResponse = parseProviderResponse(
        providerResponse,
        { selectedProvider: providerResponse.provider, selectedModel: providerResponse.model, fallbackUsed: false, ruleMatched: "cache", alternatives: [] },
        startTime
      );
      gatewayResponse.cacheHit = true;

      const duration = Date.now() - startTime;
      // Cached responses incur no provider charge; audit cost is 0 and the
      // costBasis marks the entry as cache-served rather than measured spend.
      const auditEntry = buildAuditEntry(context, gatewayResponse, duration, "cached", undefined, 0);
      auditEntry.costBasis = "cached";
      await storage.auditLog.write(auditEntry).catch((e) => reportLifecycleError("audit", e));
      recordGatewayRequest({
        status: "cached",
        provider: gatewayResponse.provider,
        model: gatewayResponse.model,
        cacheHit: true,
        fallbackUsed: false,
        durationMs: duration,
        costUsd: 0,
      });

      res.json(gatewayResponse);
      return;
    }

    const router = new Router(config.routing);
    const decision = router.route(context);

    const providerRequest = buildProviderRequest(context, decision);
    const provider = getProvider(decision.selectedProvider, config);

    let providerResponse: ProviderResponse;
    let fallbackUsed = false;
    try {
      providerResponse = await provider.complete(providerRequest);
    } catch (error) {
      recordGatewayError("provider_error", decision.selectedProvider, decision.selectedModel);
      providerResponse = await handleFallback(
        context,
        error instanceof Error ? error : new Error(String(error)),
        decision,
        config
      );
      fallbackUsed = true;
    }

    const cost = calculateCost(
      providerResponse.model,
      providerResponse.usage.promptTokens,
      providerResponse.usage.completionTokens
    );

    // Settle the reservation under the canonical account identity. Missing
    // provider usage settles explicitly as unknown (reservation released,
    // no fabricated spend recorded).
    if (context.budgetReserved) {
      const usageKnown = providerResponse.usage != null;
      context.usageUnknown = !usageKnown;
      await storage.budgetTracker
        .settle(
          context.accountId ?? context.apiKeyId ?? context.apiKey,
          context.requestId,
          usageKnown ? cost : null
        )
        .catch((e) => reportLifecycleError("settle", e));
      context.budgetReserved = false;
    }

    const cacheKey = generateCacheKey(context);
    await storage.cacheStore.set(cacheKey, { response: providerResponse as unknown as Record<string, unknown>, timestamp: Date.now() }).catch(() => {});

    const gatewayResponse: GatewayResponse = parseProviderResponse(
      providerResponse,
      decision,
      startTime
    );
    gatewayResponse.fallbackUsed = fallbackUsed;

    const duration = Date.now() - startTime;

    logResponse(
      context.requestId,
      gatewayResponse.model,
      gatewayResponse.provider,
      duration,
      gatewayResponse.usage.promptTokens,
      gatewayResponse.usage.completionTokens
    );

    const auditEntry = buildAuditEntry(context, gatewayResponse, duration, "success", undefined, cost);
    auditEntry.costBasis = context.usageUnknown ? "unknown" : "measured";
    await storage.auditLog.write(auditEntry).catch((e) => reportLifecycleError("audit", e));
    recordGatewayRequest({
      status: "success",
      provider: gatewayResponse.provider,
      model: gatewayResponse.model,
      cacheHit: false,
      fallbackUsed,
      durationMs: duration,
      costUsd: cost,
    });

    res.json(gatewayResponse);
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : "Unknown error";

    // The request died after reservation but before settlement — release it
    // so failed requests cannot leak budget capacity.
    if (context?.budgetReserved) {
      await storage.budgetTracker
        .release(context.accountId ?? context.apiKeyId ?? context.apiKey, context.requestId)
        .catch(() => {});
      context.budgetReserved = false;
    }

    if (!context) {
      recordGatewayError("gateway_error");
      res.status(502).json({
        error: { message, type: "gateway_error", code: "provider_error" },
      });
      return;
    }

    const auditEntry = buildAuditEntry(context, null, duration, "error", message);
    await storage.auditLog.write(auditEntry).catch((e) => reportLifecycleError("audit", e));
    recordGatewayError("gateway_error", "unknown", context?.originalModel ?? "unknown");
    recordGatewayRequest({
      status: "error",
      provider: "unknown",
      model: context?.originalModel ?? "unknown",
      cacheHit: false,
      fallbackUsed: false,
      durationMs: duration,
      costUsd: 0,
    });

    res.status(502).json({
      error: { message, type: "gateway_error", code: "provider_error" },
    });
  }
}

/**
 * Builds an audit log entry from the request context and response.
 * @param context - Processed request context.
 * @param response - Gateway response or null if error.
 * @param durationMs - Request duration in milliseconds.
 * @param status - Request result status.
 * @param errorMessage - Optional error message.
 * @param costUsd - Calculated cost in USD.
 * @returns Audit entry for storage.
 */
function buildAuditEntry(
  context: RequestContext,
  response: GatewayResponse | null,
  durationMs: number,
  status: AuditEntry["status"],
  errorMessage?: string,
  costUsd?: number
): AuditEntry {
  return {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    apiKey: context.apiKey,
    apiKeyName: context.apiKeyName,
    accountId: context.accountId ?? context.apiKeyId,
    model: response?.model ?? context.originalModel,
    provider: response?.provider ?? "unknown",
    inputTokens: response?.usage?.promptTokens ?? 0,
    outputTokens: response?.usage?.completionTokens ?? 0,
    costUsd: costUsd ?? (response ? calculateCost(response.model, response.usage.promptTokens, response.usage.completionTokens) : 0),
    latencyMs: durationMs,
    status,
    errorMessage,
    cacheHit: response?.cacheHit ?? false,
    fallbackUsed: response?.fallbackUsed ?? false,
  };
}
