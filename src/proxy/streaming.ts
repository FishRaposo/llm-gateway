/** Streaming response handler for SSE forwarding. */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { GatewayConfig, AuditEntry } from "../types";
import type { RequestContext } from "../types/routing";
import type { ProviderRequest } from "../types/provider";
import type { RoutingDecision } from "../types/routing";
import { getProvider } from "../providers/registry";
import { handleFallback } from "../routing/fallback";
import { calculateCost } from "../shared/pricing";
import type { StorageInstances } from "./handler";

/**
 * Handles a streaming request by setting up SSE headers and forwarding provider stream chunks.
 * @param req - Express request object.
 * @param res - Express response object.
 * @param context - Processed request context.
 * @param providerRequest - Provider-formatted request.
 * @param providerName - Name of the target provider.
 * @param config - Gateway configuration.
 * @param decision - Routing decision with alternatives.
 * @param storage - Storage backend instances.
 */
export async function handleStreamingRequest(
  _req: Request,
  res: Response,
  context: RequestContext,
  providerRequest: ProviderRequest,
  providerName: string,
  config: GatewayConfig,
  decision: RoutingDecision,
  storage: StorageInstances
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const startTime = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let finalModel = providerRequest.model;
  let finalProvider = providerName;
  let fallbackUsed = false;

  try {
    const provider = getProvider(providerName, config);
    const stream = provider.streamComplete(providerRequest);

    for await (const chunk of stream) {
      const data = JSON.stringify(chunk);
      res.write(`data: ${data}\n\n`);

      if (chunk.usage) {
        inputTokens = chunk.usage.promptTokens;
        outputTokens = chunk.usage.completionTokens;
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();

    const duration = Date.now() - startTime;
    const cost = calculateCost(finalModel, inputTokens, outputTokens);

    await storage.budgetTracker.deductBudget(context.apiKey, cost).catch(() => {});
    await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, cost, duration, "success", fallbackUsed, false);
  } catch (error) {
    try {
      const fallbackResponse = await handleFallback(
        context,
        error instanceof Error ? error : new Error(String(error)),
        decision,
        config
      );

      finalModel = fallbackResponse.model;
      finalProvider = fallbackResponse.provider;
      inputTokens = fallbackResponse.usage.promptTokens;
      outputTokens = fallbackResponse.usage.completionTokens;
      fallbackUsed = true;

      const chunk = JSON.stringify(fallbackResponse);
      res.write(`data: ${chunk}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();

      const duration = Date.now() - startTime;
      const cost = calculateCost(finalModel, inputTokens, outputTokens);

      await storage.budgetTracker.deductBudget(context.apiKey, cost).catch(() => {});
      await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, cost, duration, "success", fallbackUsed, false);
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : "Stream fallback error";
      const errorData = JSON.stringify({
        error: { message, type: "stream_error", code: "provider_error" },
      });
      res.write(`data: ${errorData}\n\n`);
      res.end();

      const duration = Date.now() - startTime;
      await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, 0, duration, "error", fallbackUsed, false, message);
    }
  }
}

async function writeAuditEntry(
  storage: StorageInstances,
  context: RequestContext,
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  durationMs: number,
  status: AuditEntry["status"],
  fallbackUsed: boolean,
  cacheHit: boolean,
  errorMessage?: string
): Promise<void> {
  await storage.auditLog.write({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    apiKey: context.apiKey,
    apiKeyName: context.apiKeyName,
    model,
    provider,
    inputTokens,
    outputTokens,
    costUsd: cost,
    latencyMs: durationMs,
    status,
    errorMessage,
    cacheHit,
    fallbackUsed,
  });
}
