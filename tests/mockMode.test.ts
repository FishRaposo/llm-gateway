import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, invalidateConfig } from "../src/config";
import { clearProviderRegistry } from "../src/providers/registry";
import { toClientRefusal } from "../src/proxy/handler";

const ENV_KEYS = [
  "MOCK_PROVIDER",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OLLAMA_BASE_URL",
  "OLLAMA_ENABLED",
  "CONFIG_DIR",
  "GATEWAY_API_KEY",
  "DATABASE_PATH",
  "REDIS_URL",
  "DEFAULT_MODEL",
  "DEFAULT_PROVIDER",
];

let savedEnv: Record<string, string | undefined> = {};
let emptyConfigDir: string;

/**
 * Puts the process in the "fresh clone" state: no provider keys and no YAML
 * config. Keys are set to "" (not deleted) so dotenv can't load a developer's
 * local .env over them.
 */
function freshCloneEnv(): void {
  process.env.OPENAI_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.OLLAMA_BASE_URL = "";
  process.env.OLLAMA_ENABLED = "false";
  process.env.MOCK_PROVIDER = "";
  process.env.DEFAULT_MODEL = "";
  process.env.DEFAULT_PROVIDER = "";
  process.env.CONFIG_DIR = emptyConfigDir;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  emptyConfigDir = mkdtempSync(join(tmpdir(), "llm-gateway-test-config-"));
  freshCloneEnv();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(emptyConfigDir, { recursive: true, force: true });
  invalidateConfig();
  clearProviderRegistry();
});

describe("mock mode configuration", () => {
  it("registers the mock provider and routes to it when no keys are set", () => {
    const config = loadConfig();
    expect(Object.keys(config.providers)).toEqual(["mock"]);
    expect(config.providers.mock.type).toBe("mock");
    expect(config.routing.default).toEqual({ provider: "mock", model: "mock" });
    expect(config.defaultProvider).toBe("mock");
  });

  it("MOCK_PROVIDER=false disables the mock even with no keys", () => {
    process.env.MOCK_PROVIDER = "false";
    const config = loadConfig();
    expect(config.providers.mock).toBeUndefined();
    expect(config.routing.default.provider).toBe("openai");
  });

  it("does not add the mock when a real provider key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const config = loadConfig();
    expect(Object.keys(config.providers)).toEqual(["openai"]);
    expect(config.routing.default.provider).toBe("openai");
  });

  it("MOCK_PROVIDER=true adds the mock alongside real providers without changing the default route", () => {
    process.env.MOCK_PROVIDER = "true";
    process.env.OPENAI_API_KEY = "sk-test";
    const config = loadConfig();
    expect(Object.keys(config.providers).sort()).toEqual(["mock", "openai"]);
    expect(config.routing.default.provider).toBe("openai");
  });
});

describe("refusal mapping", () => {
  function refusalError(statusCode: number, code: string): Error {
    return Object.assign(new Error("refused"), { statusCode, code });
  }

  it.each([
    [401, "unauthorized", "authentication_error", "error"],
    [402, "budget_exceeded", "budget_error", "budget_exceeded"],
    [403, "guardrails_denied", "policy_error", "policy_denied"],
    [429, "rate_limit_exceeded", "rate_limit_error", "rate_limited"],
  ])("maps %i/%s to type %s and audit status %s", (statusCode, code, type, auditStatus) => {
    expect(toClientRefusal(refusalError(statusCode, code))).toEqual({ statusCode, code, type, auditStatus });
  });

  it("leaves provider failures and plain errors to the 502 path", () => {
    expect(toClientRefusal(new Error("upstream timeout"))).toBeNull();
    expect(toClientRefusal(refusalError(500, "server_error"))).toBeNull();
    expect(toClientRefusal("not an error")).toBeNull();
  });
});

describe("POST /v1/chat/completions in mock mode (HTTP level)", () => {
  let server: Server;
  let baseUrl: string;
  const KEY = "mock-mode-test-key";

  beforeAll(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    emptyConfigDir = mkdtempSync(join(tmpdir(), "llm-gateway-test-config-"));
    freshCloneEnv();
    process.env.GATEWAY_API_KEY = KEY;
    process.env.DATABASE_PATH = ":memory:";
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    invalidateConfig();
    clearProviderRegistry();

    // Importing the entry module must not start a server by itself.
    const { createApp } = await import("../src/index");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function chat(authorization?: string): Promise<Response> {
    return fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ model: "mock", messages: [{ role: "user", content: "Hello" }] }),
    });
  }

  it("returns a 200 chat completion from the mock provider with no keys configured", async () => {
    const res = await chat(`Bearer ${KEY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.provider).toBe("mock");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content.length).toBeGreaterThan(0);
  });

  it("rejects an invalid key with 401 unauthorized, not 502 provider_error", async () => {
    const res = await chat("Bearer not-a-real-key");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid API key", type: "authentication_error", code: "unauthorized" },
    });
  });

  it("rejects a missing Authorization header with 401 unauthorized", async () => {
    const res = await chat();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });
});
