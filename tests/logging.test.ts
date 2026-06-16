import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createLoggingMiddleware,
  logRequest,
  logResponse,
} from "../src/middleware/logging";
import type { GatewayConfig } from "../src/types";
import type { RequestContext } from "../src/types/routing";
import type { AuditLogStorage } from "../src/storage/auditLog";

const config = {} as GatewayConfig;
const auditLog = {} as AuditLogStorage;

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "req-abc",
    apiKey: "sk-secret-1234567890",
    apiKeyName: "test-key",
    permissions: [],
    originalModel: "gpt-4o",
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ],
    stream: false,
    metadata: {},
    timestamp: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Logging middleware", () => {
  it("passes the context through unchanged", async () => {
    const mw = createLoggingMiddleware(config, auditLog);
    const ctx = makeContext();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await mw(ctx, config);
    expect(result).toBe(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("redacts the api key to a short prefix when logging a request", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logRequest(makeContext());
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.message).toBe("request_received");
    expect(logged.apiKey).toBe("sk-secre...");
    expect(logged.apiKey).not.toContain("1234567890");
    expect(logged.messageCount).toBe(2);
    expect(logged.model).toBe("gpt-4o");
  });

  it("emits structured response metadata", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logResponse("resp-1", "gpt-4o", "openai", 1234, 100, 50);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: "info",
      message: "response_sent",
      responseId: "resp-1",
      model: "gpt-4o",
      provider: "openai",
      durationMs: 1234,
      inputTokens: 100,
      outputTokens: 50,
    });
  });
});
