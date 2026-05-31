/** LLM Gateway - Express application entry point. */

import express from "express";
import cors from "cors";
import { getConfig } from "./config";
import { handleRequest } from "./proxy/handler";
import { createAdminRouter } from "./admin/routes";
import { AuditLogStorage } from "./storage/auditLog";
import { CacheStore } from "./storage/cacheStore";
import { BudgetTracker } from "./storage/budgetTracker";
import { createAuthMiddleware } from "./middleware/auth";
import { createRateLimitMiddleware, initRateLimitRedis } from "./middleware/rateLimit";
import { createCacheMiddleware } from "./middleware/cache";
import { createBudgetMiddleware } from "./middleware/budget";
import { createLoggingMiddleware } from "./middleware/logging";
import { createPolicyMiddleware } from "./middleware/policy";
import { renderPrometheusMetrics } from "./metrics";
import type { GatewayConfig } from "./types";

/**
 * Initializes storage backends based on configuration.
 * @param config - Gateway configuration.
 * @returns Object containing initialized storage instances.
 */
function initializeStorage(config: GatewayConfig) {
  const auditLog = new AuditLogStorage(config.databasePath);
  const cacheStore = new CacheStore(config.redisUrl);
  const budgetTracker = new BudgetTracker(config.redisUrl, config.budgets.globalLimitUsd);

  return { auditLog, cacheStore, budgetTracker };
}

/**
 * Builds the middleware chain in execution order.
 * @param storage - Initialized storage backends.
 * @param config - Gateway configuration.
 * @returns Ordered array of middleware functions.
 */
function buildMiddlewareChain(storage: ReturnType<typeof initializeStorage>, config: GatewayConfig) {
  return [
    createAuthMiddleware(config),
    createPolicyMiddleware(config),
    createBudgetMiddleware(config, storage.budgetTracker),
    createCacheMiddleware(config, storage.cacheStore),
    createRateLimitMiddleware(config),
    createLoggingMiddleware(config, storage.auditLog),
  ];
}

/**
 * Creates and configures the Express application.
 * @returns Configured Express app instance.
 */
export function createApp(): express.Application {
  const config = getConfig();
  const storage = initializeStorage(config);
  const middlewareChain = buildMiddlewareChain(storage, config);

  initRateLimitRedis(config.redisUrl).catch(() => {});

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req: express.Request, res: express.Response) => {
    res.json({ status: "ok", version: "1.0.0" });
  });

  app.get("/metrics", (_req: express.Request, res: express.Response) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(renderPrometheusMetrics());
  });

  app.post("/v1/chat/completions", async (req: express.Request, res: express.Response) => {
    await handleRequest(req, res, middlewareChain, storage, config);
  });

  app.use("/admin", createAdminRouter(storage, config));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Gateway] Unhandled error:", err);
    res.status(500).json({
      error: {
        message: "Internal gateway error",
        type: "gateway_error",
        code: "internal_error",
      },
    });
  });

  return app;
}

const app = createApp();
const config = getConfig();

app.listen(config.port, () => {
  console.log(`[Gateway] LLM Gateway running on port ${config.port}`);
  console.log(`[Gateway] Default model: ${config.defaultModel}`);
  console.log(`[Gateway] Providers: ${Object.keys(config.providers).join(", ") || "none configured"}`);
});

export default app;
