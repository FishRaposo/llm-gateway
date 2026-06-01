/** LLM Gateway - Express application entry point. */

import express from "express";
import cors from "cors";
import { getConfig } from "./config";
import { handleRequest } from "./proxy/handler";
import { createAdminRouter } from "./admin/routes";
import { AuditLogStorage } from "./storage/auditLog";
import { CacheStore } from "./storage/cacheStore";
import { BudgetTracker } from "./storage/budgetTracker";
import { ApiKeyStore } from "./storage/apiKeyStore";
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
  const apiKeyStore = new ApiKeyStore(config.databasePath);

  return { auditLog, cacheStore, budgetTracker, apiKeyStore };
}

/**
 * Builds the middleware chain in execution order.
 * @param storage - Initialized storage backends.
 * @param config - Gateway configuration.
 * @returns Ordered array of middleware functions.
 */
function buildMiddlewareChain(storage: ReturnType<typeof initializeStorage>, config: GatewayConfig) {
  return [
    createAuthMiddleware(config, storage.apiKeyStore),
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
const storage = initializeStorage(config);

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({
    level: "info",
    message: "Gateway started",
    port: config.port,
    defaultModel: config.defaultModel,
    providers: Object.keys(config.providers),
  }));
});

/**
 * Gracefully shuts down the gateway server.
 * Stops accepting new connections, drains in-flight requests,
 * closes storage backends, and exits the process.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", message: "Shutdown initiated", signal }));

  // Stop accepting new connections
  server.close(() => {
    console.log(JSON.stringify({ level: "info", message: "HTTP server closed" }));
  });

  // Give in-flight requests a grace period to complete
  const drainTimeoutMs = 10000;
  await new Promise((resolve) => setTimeout(resolve, drainTimeoutMs));

  // Close storage backends
  try {
    await storage.cacheStore.close();
  } catch {
    // ignore
  }
  try {
    await storage.budgetTracker.close();
  } catch {
    // ignore
  }

  console.log(JSON.stringify({ level: "info", message: "Shutdown complete" }));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
