/** Admin API routes for usage, budgets, logs, and health. */

import { Router } from "express";
import type { GatewayConfig } from "../types";
import type { AuditLogStorage } from "../storage/auditLog";
import type { CacheStore } from "../storage/cacheStore";
import type { BudgetTracker } from "../storage/budgetTracker";
import type { ApiKeyStore } from "../storage/apiKeyStore";
import { getUsageStats, getProviderHealth } from "./dashboard";
import { validateApiKey, listApiKeys, registerApiKey, maskApiKey } from "../middleware/auth";

export interface AdminStorage {
  auditLog: AuditLogStorage;
  cacheStore: CacheStore;
  budgetTracker: BudgetTracker;
  apiKeyStore: ApiKeyStore;
}

/**
 * Creates the admin API router with all admin endpoints.
 * @param storage - Storage backend instances.
 * @param config - Gateway configuration.
 * @returns Express router with admin routes.
 */
export function createAdminRouter(storage: AdminStorage, config: GatewayConfig): Router {
  const router = Router();

  router.use(async (req, _res, next) => {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (!apiKey || !(await validateApiKey(storage.apiKeyStore, apiKey))) {
      _res.status(401).json({ error: { message: "Unauthorized", code: "unauthorized" } });
      return;
    }
    next();
  });

  router.get("/usage", async (_req, res) => {
    try {
      const stats = await getUsageStats(storage.auditLog);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: { message: "Failed to get usage stats" } });
    }
  });

  router.get("/budgets", async (_req, res) => {
    try {
      const keys = await listApiKeys(storage.apiKeyStore);
      const budgets = [];
      for (const keyInfo of keys) {
        const status = await storage.budgetTracker.getBudgetStatus(keyInfo.id);
        budgets.push({
          key: maskApiKey(keyInfo.id),
          name: keyInfo.name,
          limitUsd: status.limit,
          usedUsd: status.used,
          remainingUsd: status.remaining,
          period: "monthly",
        });
      }
      res.json({ budgets });
    } catch (error) {
      res.status(500).json({ error: { message: "Failed to get budgets" } });
    }
  });

  router.get("/logs", async (req, res) => {
    try {
      const filters = {
        apiKey: req.query.api_key as string | undefined,
        model: req.query.model as string | undefined,
        provider: req.query.provider as string | undefined,
        status: req.query.status as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        limit: parseInt(req.query.limit as string, 10) || 100,
        offset: parseInt(req.query.offset as string, 10) || 0,
      };
      const logs = await storage.auditLog.query(filters);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ error: { message: "Failed to query logs" } });
    }
  });

  router.post("/keys", async (req, res) => {
    try {
      const { name, budget_usd, allowed_models } = req.body;
      const created = await registerApiKey(storage.apiKeyStore, {
        name: name || "unnamed",
        budgetUsd: budget_usd || config.budgets.defaultKeyBudgetUsd,
        allowedModels: allowed_models || ["*"],
      });

      res.json({
        apiKey: created.apiKey,
        name: created.name,
        budgetUsd: created.budgetUsd,
        allowedModels: created.allowedModels,
      });
    } catch (error) {
      res.status(500).json({ error: { message: "Failed to create API key" } });
    }
  });

  router.get("/health", async (_req, res) => {
    try {
      const providerHealth = await getProviderHealth(config);

      let redis: string;
      let database: string;

      try {
        const redisOk = await storage.cacheStore.ping();
        redis = redisOk ? "connected" : "disconnected";
      } catch (err) {
        redis = `error: ${err instanceof Error ? err.message : "unknown"}`;
      }

      try {
        const dbOk = await storage.auditLog.ping();
        database = dbOk ? "connected" : "disconnected";
      } catch (err) {
        database = `error: ${err instanceof Error ? err.message : "unknown"}`;
      }

      res.json({
        status: "healthy",
        providers: providerHealth,
        redis,
        database,
        uptimeSeconds: process.uptime(),
      });
    } catch (error) {
      res.status(500).json({
        status: "unhealthy",
        providers: {},
        redis: "unknown",
        database: "unknown",
        uptimeSeconds: process.uptime(),
      });
    }
  });

  return router;
}
