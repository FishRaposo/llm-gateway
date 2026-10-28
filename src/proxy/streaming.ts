/** Streaming response handler for SSE forwarding. */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { GatewayConfig, AuditEntry } from "../types";
import type { RequestContext } from "../types/routing";
import type { ProviderRequest } from "../types/provider";
import type { RoutingDecision } from "../types/routing";
import { getProvider } from "../providers/registry";
import { handleFallback } from "../routing/fallback";
import { calculateCost, getPricing } from "../shared/pricing";
import type { StorageInstances } from "./handler";
import { recordGatewayError } from "../metrics";
import { isValidUsage, normalizeUsage } from "../providers/usage";

/**
 * Handles a streaming request by setting up SSE headers and forwarding provider stream chunks.
 *
 * Streaming invariants enforced here:
 * - Fallback is permitted only before any content has been emitted. Once the
 *   first chunk reaches the client the primary response is committed; a later
 *   provider error yields exactly one terminal error marker, never a second
 *   completion disguised as the same stream.
 * - The budget reservation settles with measured usage (or explicitly unknown)
 *   on completion, releases when nothing was consumed, and settles partial
 *   usage when the stream died mid-content.
 * - Exactly one terminal marker ([DONE] or a stream_error frame) is written.
 *
 * @param req - Express request object (client disconnect aborts the provider stream).
 * @param res - Express response object.
 * @param context - Processed request context.
 * @param providerRequest - Provider-formatted request.
 * @param providerName - Name of the target provider.
 * @param config - Gateway configuration.
 * @param decision - Routing decision with alternatives.
 * @param storage - Storage backend instances.
 */
export async function handleStreamingRequest(
  req: Request,
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
  const accountId = context.accountId ?? context.apiKeyId ?? context.apiKey;
  let inputTokens = 0;
  let outputTokens = 0;
  let usageSeen = false;
  let finalModel = providerRequest.model;
  let finalProvider = providerName;
  let fallbackUsed = false;
  let contentEmitted = false;
  let terminated = false;

  const abortController = new AbortController();
  const onClientClose = () => abortController.abort();
  req.on?.("close", onClientClose);

  /** Writes one terminal frame exactly once. */
  const terminate = (frame: "done" | "error", message?: string) => {
    if (terminated) return;
    terminated = true;
    if (frame === "done") {
      res.write("data: [DONE]\n\n");
    } else {
      res.write(
        `data: ${JSON.stringify({ error: { message: message ?? "Stream error", type: "stream_error", code: "provider_error" } })}\n\n`
      );
    }
    res.end();
  };

  /** Settles or releases the held reservation for this requestId. */
  const lifecycle = async (action: "settle" | "release", cost: number | null) => {
    if (!context.budgetReserved) return;
    try {
      if (action === "settle") {
        await storage.budgetTracker.settle(accountId, context.requestId, cost);
      } else {
        await storage.budgetTracker.release(accountId, context.requestId);
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          message: `Budget ${action} failure`,
          error: e instanceof Error ? e.message : String(e),
        })
      );
      recordGatewayError(`budget_${action}_failure`);
    }
    context.budgetReserved = false;
  };

  try {
    const provider = getProvider(providerName, config);
    const stream = provider.streamComplete(providerRequest, abortController.signal);

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      finalModel = chunk.model || finalModel;
      const chunkUsageKnown = chunk.usageKnown !== false && isValidUsage(chunk.usage);
      const data = JSON.stringify({
        ...chunk,
        usage: chunkUsageKnown ? chunk.usage : normalizeUsage(undefined, undefined, undefined).usage,
        usageKnown: chunkUsageKnown,
        costBasis: chunkUsageKnown && getPricing(finalModel) !== null ? "measured" : "unknown",
      });
      res.write(`data: ${data}\n\n`);
      contentEmitted = true;

      if (chunkUsageKnown && getPricing(finalModel) !== null) {
        inputTokens = chunk.usage.promptTokens;
        outputTokens = chunk.usage.completionTokens;
        usageSeen = true;
      }
    }

    if (abortController.signal.aborted) {
      // Client disconnected mid-stream: settle whatever usage was measured
      // (or unknown) — the provider-side work still happened.
      await lifecycle("settle", usageSeen ? calculateCost(finalModel, inputTokens, outputTokens) : null);
      if (!usageSeen) context.usageUnknown = true;
      await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, 0, Date.now() - startTime, "error", fallbackUsed, false, !usageSeen, "client_disconnected");
      terminate("error", "client_disconnected");
      return;
    }

    terminate("done");

    const duration = Date.now() - startTime;
    const cost = usageSeen ? calculateCost(finalModel, inputTokens, outputTokens) : null;
    if (!usageSeen) context.usageUnknown = true;
    await lifecycle("settle", cost);
    await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, cost ?? 0, duration, "success", fallbackUsed, false, !usageSeen);
  } catch (error) {
    if (!contentEmitted) {
      // Nothing reached the client — fallback remains safe and atomic.
      try {
        const fallbackResponse = await handleFallback(
          context,
          error instanceof Error ? error : new Error(String(error)),
          decision,
          config
        );

        finalModel = fallbackResponse.model;
        finalProvider = fallbackResponse.provider;
        inputTokens = fallbackResponse.usage?.promptTokens ?? 0;
        outputTokens = fallbackResponse.usage?.completionTokens ?? 0;
        fallbackUsed = true;
        const fallbackUsageKnown = fallbackResponse.usageKnown !== false && isValidUsage(fallbackResponse.usage) && getPricing(finalModel) !== null;

        const chunk = JSON.stringify({
          ...fallbackResponse,
          usage: isValidUsage(fallbackResponse.usage) ? fallbackResponse.usage : normalizeUsage(undefined, undefined, undefined).usage,
          usageKnown: fallbackResponse.usageKnown !== false && isValidUsage(fallbackResponse.usage),
          costBasis: fallbackUsageKnown ? "measured" : "unknown",
        });
        res.write(`data: ${chunk}\n\n`);
        terminate("done");

        const duration = Date.now() - startTime;
        const cost = fallbackUsageKnown ? calculateCost(finalModel, inputTokens, outputTokens) : null;
        if (!fallbackUsageKnown) context.usageUnknown = true;
        await lifecycle("settle", cost);
        await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, cost ?? 0, duration, "success", fallbackUsed, false, !fallbackUsageKnown);
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : "Stream fallback error";
        terminate("error", message);

        // Nothing was consumed or emitted — release the reservation rather
        // than charging for a failed request.
        await lifecycle("settle", null);
        await writeAuditEntry(storage, context, finalModel, finalProvider, 0, 0, 0, Date.now() - startTime, "error", fallbackUsed, false, true, message);
      }
      return;
    }

    // Content already emitted: the primary response is committed. Emit one
    // explicit terminal error — never a disguised second completion.
    const message = error instanceof Error ? error.message : "Stream error";
    terminate("error", message);

    // Settle measured partial usage; partial consumption is real spend.
    const partialCost = usageSeen ? calculateCost(finalModel, inputTokens, outputTokens) : null;
    if (!usageSeen) context.usageUnknown = true;
    await lifecycle("settle", partialCost);
    await writeAuditEntry(storage, context, finalModel, finalProvider, inputTokens, outputTokens, partialCost ?? 0, Date.now() - startTime, "error", fallbackUsed, false, !usageSeen, `partial_stream: ${message}`);
  } finally {
    req.off?.("close", onClientClose);
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
  usageUnknown: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    await storage.auditLog.write({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      apiKey: context.apiKey,
      apiKeyName: context.apiKeyName,
      accountId: context.accountId ?? context.apiKeyId,
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
      costBasis: cacheHit ? "cached" : usageUnknown ? "unknown" : "measured",
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Audit write failure",
        error: e instanceof Error ? e.message : String(e),
      })
    );
    recordGatewayError("audit_write_failure");
  }
}
