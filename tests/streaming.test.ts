import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStreamingRequest } from "../src/proxy/streaming";
import type { RequestContext } from "../src/types/routing";
import type { ProviderRequest } from "../src/types/provider";
import type { RoutingDecision } from "../src/types/routing";
import type { GatewayConfig } from "../src/types";

function mockRes() {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  return {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    write: (d: string) => { chunks.push(d); return true; },
    end: () => {},
    headers,
    chunks,
  };
}

const baseConfig: GatewayConfig = {
  port: 3000,
  logLevel: "info",
  defaultModel: "gpt-4o-mini",
  defaultProvider: "openai",
  databasePath: ":memory:",
  redisUrl: "redis://localhost:0",
  gatewayApiKey: "admin-key",
  providers: {
    mock: { type: "mock", apiKey: "mock-key" },
  },
  routing: {
    default: { provider: "mock", model: "mock-model" },
    rules: [],
    fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
  },
  policy: { enabled: false, evalOrder: [], rules: [] },
  budgets: { enabled: false, globalLimitUsd: 1000, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
};

const context: RequestContext = {
  requestId: "test-1",
  apiKey: "test-key",
  apiKeyName: "test",
  originalModel: "mock-model",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
  metadata: {},
  timestamp: new Date().toISOString(),
};

const providerRequest: ProviderRequest = {
  model: "mock-model",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
  metadata: {},
};

const decision: RoutingDecision = {
  selectedProvider: "mock",
  selectedModel: "mock-model",
  fallbackUsed: false,
  ruleMatched: "default",
  alternatives: [],
};

describe("Streaming Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should set SSE headers", async () => {
    const res = mockRes();
    const storage = {
      auditLog: { write: vi.fn().mockResolvedValue(undefined) },
      cacheStore: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) },
      budgetTracker: { deductBudget: vi.fn().mockResolvedValue(undefined) },
      apiKeyStore: { validate: vi.fn().mockResolvedValue({ valid: true }) },
    } as any;

    await handleStreamingRequest({} as any, res as any, context, providerRequest, "mock", baseConfig, decision, storage);

    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache");
  });

  it("should write stream chunks and [DONE]", async () => {
    const res = mockRes();
    const storage = {
      auditLog: { write: vi.fn().mockResolvedValue(undefined) },
      cacheStore: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) },
      budgetTracker: { deductBudget: vi.fn().mockResolvedValue(undefined) },
      apiKeyStore: { validate: vi.fn().mockResolvedValue({ valid: true }) },
    } as any;

    await handleStreamingRequest({} as any, res as any, context, providerRequest, "mock", baseConfig, decision, storage);

    const doneFound = res.chunks.some((c) => c.includes("[DONE]"));
    expect(doneFound).toBe(true);
  });

  it("should write audit entry after stream completes", async () => {
    const res = mockRes();
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const storage = {
      auditLog: { write: writeMock },
      cacheStore: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) },
      budgetTracker: { deductBudget: vi.fn().mockResolvedValue(undefined) },
      apiKeyStore: { validate: vi.fn().mockResolvedValue({ valid: true }) },
    } as any;

    await handleStreamingRequest({} as any, res as any, context, providerRequest, "mock", baseConfig, decision, storage);

    expect(writeMock).toHaveBeenCalled();
    const entry = writeMock.mock.calls[0][0];
    expect(entry.status).toBe("success");
    expect(entry.apiKey).toBe("test-key");
  });
});
