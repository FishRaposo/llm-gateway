/* eslint-disable @typescript-eslint/no-explicit-any */
/** Stream-semantics invariants: fallback only pre-content, one terminal marker,
 * explicit partial failure, client-abort propagation to the provider request. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { RequestContext, RoutingDecision } from "../src/types/routing";
import type { GatewayConfig } from "../src/types";
import type { ProviderRequest, ProviderResponse } from "../src/types/provider";

// Registry injection point: each test populates this map with provider stubs.
const providers = new Map<string, { complete?: any; streamComplete?: any }>();
vi.mock("../src/providers/registry", () => ({
  getProvider: (name: string) => {
    const p = providers.get(name);
    if (!p) throw new Error(`Provider "${name}" is not configured`);
    return p;
  },
}));

import { handleStreamingRequest } from "../src/proxy/streaming";

function makeConfig(): GatewayConfig {
  return {
    port: 3000,
    logLevel: "info",
    defaultModel: "m",
    defaultProvider: "primary",
    databasePath: ":memory:",
    redisUrl: "redis://localhost:0",
    gatewayApiKey: "admin-key",
    providers: {
      primary: { type: "mock", apiKey: "k" },
      backup: { type: "mock", apiKey: "k" },
    },
    routing: {
      default: { provider: "primary", model: "m" },
      rules: [],
      fallback: { enabled: true, maxRetries: 3, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000 } },
    },
    policy: { enabled: false, evalOrder: [], rules: [] },
    budgets: { enabled: true, globalLimitUsd: Infinity, defaultKeyBudgetUsd: 100, period: "monthly", alertThresholdPercent: 80 },
  };
}

function makeContext(): RequestContext {
  return {
    requestId: "req-sem",
    apiKey: "gw-plaintext-secret",
    apiKeyName: "tester",
    accountId: "acct-1",
    permissions: ["chat"],
    originalModel: "m",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    budgetReserved: true,
    metadata: {},
    timestamp: new Date().toISOString(),
  };
}

function makeRes() {
  const chunks: string[] = [];
  return {
    setHeader: vi.fn(),
    write: (d: string) => { chunks.push(d); return true; },
    end: vi.fn(),
    chunks,
  };
}

function makeStorage() {
  return {
    auditLog: { write: vi.fn().mockResolvedValue(undefined) },
    cacheStore: { set: vi.fn(), get: vi.fn().mockResolvedValue(null) },
    budgetTracker: {
      settle: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    },
    apiKeyStore: {},
  } as any;
}

const providerRequest: ProviderRequest = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
  metadata: {},
};

function chunk(text: string, usage = false): ProviderResponse {
  return {
    id: "c1",
    model: "m",
    provider: "primary",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finishReason: null }],
    usage: usage ? { promptTokens: 4, completionTokens: 2, totalTokens: 6 } : undefined,
  } as any;
}

const decision: RoutingDecision = {
  selectedProvider: "primary",
  selectedModel: "m",
  fallbackUsed: false,
  ruleMatched: "default",
  alternatives: [{ provider: "backup", model: "m", priority: 1 }],
};

describe("Stream semantics", () => {
  beforeEach(() => {
    providers.clear();
    vi.clearAllMocks();
  });

  it("post-content failure emits one terminal error and never a disguised fallback completion", async () => {
    providers.set("primary", {
      streamComplete: async function* () {
        yield chunk("partial ");
        yield chunk("output ", true);
        throw new Error("upstream connection reset");
      },
    });
    providers.set("backup", {
      streamComplete: async function* () {
        yield chunk("SHOULD NEVER APPEAR");
      },
      complete: async () => chunk("SHOULD NEVER APPEAR"),
    });

    const res = makeRes();
    const storage = makeStorage();
    const req = new EventEmitter();
    await handleStreamingRequest(req as any, res as any, makeContext(), providerRequest, "primary", makeConfig(), decision, storage);

    const body = res.chunks.join("");
    expect(body).toContain("partial ");
    // Exactly one terminal marker, and it is an explicit error — not [DONE].
    expect(body).toContain("stream_error");
    expect(body).not.toContain("[DONE]");
    expect(body).not.toContain("SHOULD NEVER APPEAR");
    // Partial measured usage was settled, not released.
    expect(storage.budgetTracker.settle).toHaveBeenCalledTimes(1);
    // Audit records the partial failure explicitly.
    const auditCall = storage.auditLog.write.mock.calls[0][0];
    expect(auditCall.status).toBe("error");
    expect(auditCall.errorMessage).toContain("partial_stream");
  });

  it("pre-content failure still falls back and completes normally", async () => {
    providers.set("primary", {
      streamComplete: async function* () {
        throw new Error("primary exploded before content");
      },
    });
    providers.set("backup", {
      complete: async () => ({
        id: "fb-1",
        model: "m",
        provider: "backup",
        choices: [{ index: 0, message: { role: "assistant", content: "fallback answer" }, finishReason: "stop" }],
        usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7 },
      }),
      streamComplete: async function* () {},
    });

    const res = makeRes();
    const storage = makeStorage();
    const req = new EventEmitter();
    await handleStreamingRequest(req as any, res as any, makeContext(), providerRequest, "primary", makeConfig(), decision, storage);

    const body = res.chunks.join("");
    expect(body).toContain("fallback answer");
    expect(body).toContain("[DONE]");
    expect(body).not.toContain("stream_error");
    expect(storage.budgetTracker.settle).toHaveBeenCalledTimes(1);
  });

  it("total pre-content failure releases the reservation — nothing was consumed", async () => {
    providers.set("primary", {
      streamComplete: async function* () {
        throw new Error("primary down");
      },
    });
    providers.set("backup", {
      complete: async () => {
        throw new Error("backup down");
      },
      streamComplete: async function* () {},
    });

    const res = makeRes();
    const storage = makeStorage();
    const req = new EventEmitter();
    await handleStreamingRequest(req as any, res as any, makeContext(), providerRequest, "primary", makeConfig(), decision, storage);

    const body = res.chunks.join("");
    expect(body).toContain("stream_error");
    expect(storage.budgetTracker.release).toHaveBeenCalledTimes(1);
    expect(storage.budgetTracker.settle).not.toHaveBeenCalled();
  });

  it("client disconnect aborts the provider request and audits the cancellation", async () => {
    let signalSeen: AbortSignal | undefined;
    const req = new EventEmitter();
    providers.set("primary", {
      streamComplete: async function* (_r: ProviderRequest, signal?: AbortSignal) {
        signalSeen = signal;
        // Emit one chunk, then hang until aborted.
        yield chunk("first ", true);
        await new Promise((resolve) => {
          signal?.addEventListener("abort", resolve, { once: true });
        });
        if (signal?.aborted) return;
        yield chunk("late ");
      },
    });

    const res = makeRes();
    const storage = makeStorage();
    const run = handleStreamingRequest(req as any, res as any, makeContext(), providerRequest, "primary", makeConfig(), decision, storage);
    // Let the first chunk flow, then simulate the client going away.
    await new Promise((r) => setTimeout(r, 30));
    req.emit("close");
    await run;

    expect(signalSeen?.aborted).toBe(true);
    const body = res.chunks.join("");
    expect(body).not.toContain("late ");
    const auditCall = storage.auditLog.write.mock.calls[0][0];
    expect(auditCall.errorMessage).toBe("client_disconnected");
  });
});
