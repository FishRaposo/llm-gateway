/** Gateway configuration loader with validation. */

import dotenv from "dotenv";
import { readFileSync, existsSync, watch } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { GatewayConfig, ProviderConfig, RoutingConfig, PolicyConfig, BudgetConfig } from "./types";

const ProviderConfigSchema: z.ZodType<ProviderConfig> = z.object({
  type: z.enum(["openai", "anthropic", "gemini", "ollama", "mock"]),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  maxRetries: z.number().optional(),
});

const GatewayConfigSchema = z.object({
  port: z.number().default(3000),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  defaultModel: z.string().default("gpt-4o-mini"),
  defaultProvider: z.string().default("openai"),
  databasePath: z.string().default("./data/gateway.db"),
  redisUrl: z.string().default("redis://localhost:6379"),
  gatewayApiKey: z.string().default("gateway-admin-key"),
  providers: z.record(ProviderConfigSchema).default({}),
  routing: z.any().default({ default: { provider: "openai", model: "gpt-4o-mini" }, rules: [], fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } } }),
  policy: z.any().default({ enabled: false, evalOrder: [], rules: [] }),
  budgets: z.any().default({ enabled: false, globalLimitUsd: 1000, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 }),
});

/**
 * Recursively converts snake_case keys in an object to camelCase.
 * Handles nested objects and arrays.
 * @param obj - The object with snake_case keys.
 * @returns A new object with camelCase keys.
 */
function normalizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(normalizeKeys);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
      result[camelKey] = normalizeKeys(value);
    }
    return result;
  }
  return obj;
}

/**
 * Loads and validates a YAML configuration file.
 * @param filePath - Absolute path to the YAML file.
 * @returns Parsed YAML content with normalized keys, or null if file doesn't exist.
 */
function loadYamlFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  const raw = yaml.load(content);
  return normalizeKeys(raw) as T;
}

const MOCK_TRUE = new Set(["true", "1", "yes", "on"]);
const MOCK_FALSE = new Set(["false", "0", "no", "off"]);

/**
 * Decides whether the MockProvider is registered.
 * MOCK_PROVIDER true/1/yes/on: always; false/0/no/off: never (case-insensitive).
 * Unset or empty: only when no real provider is configured and NODE_ENV is not
 * "production", so a production deploy that lost its keys fails loudly instead
 * of serving fake completions.
 * @param raw - Raw MOCK_PROVIDER value.
 * @param realProviderCount - Number of real providers configured from env.
 * @param isProduction - Whether NODE_ENV is "production".
 * @returns True if the mock provider should be registered.
 * @throws Error for any other MOCK_PROVIDER value.
 */
export function resolveMockEnabled(raw: string | undefined, realProviderCount: number, isProduction: boolean): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (MOCK_TRUE.has(value)) return true;
  if (MOCK_FALSE.has(value)) return false;
  if (value === "") return realProviderCount === 0 && !isProduction;
  throw new Error(
    `Invalid MOCK_PROVIDER value "${raw}": use true/1/yes/on, false/0/no/off, or leave it unset`
  );
}

/**
 * Loads the full gateway configuration from environment variables and YAML files.
 * Environment variables take precedence over YAML defaults.
 * @returns Validated GatewayConfig object.
 */
export function loadConfig(): GatewayConfig {
  dotenv.config();

  const configDir = process.env.CONFIG_DIR || join(process.cwd(), "config");

  const routing = loadYamlFile<RoutingConfig>(join(configDir, "routing.yaml"));
  const policy = loadYamlFile<PolicyConfig>(join(configDir, "policy.yaml"));
  const budgets = loadYamlFile<BudgetConfig>(join(configDir, "budgets.yaml"));

  const providers: Record<string, ProviderConfig> = {};

  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      type: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      timeout: 30000,
      maxRetries: 2,
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = {
      type: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      timeout: 30000,
      maxRetries: 2,
    };
  }

  if (process.env.GEMINI_API_KEY) {
    providers.gemini = {
      type: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      timeout: 30000,
      maxRetries: 2,
    };
  }

  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_ENABLED === "true") {
    providers.ollama = {
      type: "ollama",
      apiKey: "ollama",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      timeout: 120000,
      maxRetries: 1,
    };
  }

  // Offline mock mode (see resolveMockEnabled). Outside production, a fresh
  // clone with no keys serves canned completions instead of failing every
  // request; in production the mock must be requested explicitly.
  const realProviderCount = Object.keys(providers).length;
  const mockEnabled = resolveMockEnabled(
    process.env.MOCK_PROVIDER,
    realProviderCount,
    process.env.NODE_ENV === "production"
  );
  if (mockEnabled) {
    providers.mock = { type: "mock", apiKey: "mock" };
  }
  // With the mock as the only provider and no routing.yaml, route to it by
  // default; the built-in default (openai) would fail with "not configured".
  const mockOnly = mockEnabled && realProviderCount === 0;

  const rawConfig = {
    port: parseInt(process.env.GATEWAY_PORT || "3000", 10),
    logLevel: process.env.LOG_LEVEL || "info",
    defaultModel: process.env.DEFAULT_MODEL || (mockOnly ? "mock" : "gpt-4o-mini"),
    defaultProvider: process.env.DEFAULT_PROVIDER || (mockOnly ? "mock" : "openai"),
    databasePath: process.env.DATABASE_PATH || "./data/gateway.db",
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    gatewayApiKey: process.env.GATEWAY_API_KEY || "gateway-admin-key",
    providers,
    routing: routing ?? {
      default: mockOnly
        ? { provider: "mock", model: "mock" }
        : { provider: "openai", model: "gpt-4o-mini" },
      rules: [],
      fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
    },
    policy: policy ?? { enabled: false, evalOrder: [], rules: [] },
    budgets: budgets ?? { enabled: false, globalLimitUsd: 1000, defaultKeyBudgetUsd: 100, period: "monthly" as const, alertThresholdPercent: 80 },
  };

  return GatewayConfigSchema.parse(rawConfig) as GatewayConfig;
}

let cachedConfig: GatewayConfig | null = null;
let watcherStarted = false;

/**
 * Returns a cached gateway configuration, loading it on first call.
 * @returns The validated GatewayConfig.
 */
export function getConfig(): GatewayConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Invalidates the cached configuration, forcing a reload on next access.
 */
export function invalidateConfig(): void {
  cachedConfig = null;
}

/**
 * Watches config/*.yaml files for changes and invalidates the cached config.
 * Should be called once after server startup.
 * @param configDir - Directory containing YAML config files.
 */
export function watchConfig(configDir: string): void {
  if (watcherStarted) return;
  watcherStarted = true;

  const files = ["routing.yaml", "policy.yaml", "budgets.yaml"];
  for (const file of files) {
    const path = join(configDir, file);
    if (existsSync(path)) {
      watch(path, (eventType) => {
        if (eventType === "change") {
          console.log(JSON.stringify({ level: "info", message: `Config file changed: ${file}` }));
          invalidateConfig();
        }
      });
    }
  }
}
