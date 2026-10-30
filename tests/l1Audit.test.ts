/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression tests for the 2026-10-30 L1 production audit findings:
// F1 default admin credential accepted in production (config.ts)
// F2 unvalidated request fields + silently dropped tool/function roles (request.ts)
// F3 input-only budget reservation ignored declared output spend (budget.ts)
import { describe, it, expect } from "vitest";
import { resolveAdminApiKey, DEFAULT_GATEWAY_API_KEY } from "../src/config";
import { parseRequest, buildProviderRequest } from "../src/proxy/request";
import { estimateRequestCost } from "../src/middleware/budget";
import { getModelInfo } from "../src/shared/pricing";
import { countMessageTokens } from "../src/shared/tokenCounter";
import type { RequestContext, RoutingDecision } from "../src/types/routing";

function makeReq(body: unknown): any {
  return { body, headers: { authorization: "Bearer test-key" }, ip: "127.0.0.1" };
}

function makeContext(overrides: Partial<RequestContext>): RequestContext {
  return {
    requestId: "req-l1",
    apiKey: "test-key",
    apiKeyName: "tester",
    permissions: ["chat"],
    originalModel: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    metadata: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("F1: default admin credential refused in production", () => {
  it("returns a configured private key in production", () => {
    expect(resolveAdminApiKey("real-secret", true)).toBe("real-secret");
  });

  it("throws when GATEWAY_API_KEY is unset in production", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(() => resolveAdminApiKey(raw, true)).toThrow(/GATEWAY_API_KEY/);
    }
  });

  it("throws when the built-in default is set explicitly in production", () => {
    expect(() => resolveAdminApiKey(DEFAULT_GATEWAY_API_KEY, true)).toThrow(/GATEWAY_API_KEY/);
  });

  it("keeps the built-in default outside production for fresh-clone demos", () => {
    expect(resolveAdminApiKey(undefined, false)).toBe(DEFAULT_GATEWAY_API_KEY);
  });
});

describe("F2: request field and role validation", () => {
  it.each(["tool", "function"])("rejects %j-role messages instead of silently dropping them", (role) => {
    const req = makeReq({
      model: "gpt-4o",
      messages: [
        { role: "assistant", content: "calling tool" },
        { role, content: "tool result" },
      ],
    });
    expect(() => parseRequest(req)).toThrow(/not forwarded/);
  });

  it("rejects unknown roles with a clear error", () => {
    const req = makeReq({ messages: [{ role: "narrator", content: "hi" }] });
    expect(() => parseRequest(req)).toThrow(/Unsupported message role "narrator"/);
  });

  it("rejects non-object message entries", () => {
    const req = makeReq({ messages: ["hello"] });
    expect(() => parseRequest(req)).toThrow(/'role' and 'content'/);
  });

  it("rejects a non-string model", () => {
    const req = makeReq({ model: 42, messages: [{ role: "user", content: "hi" }] });
    expect(() => parseRequest(req)).toThrow(/model must be a string/);
  });

  it.each([-1, NaN, "0.7"])("rejects invalid temperature %j", (temperature) => {
    const req = makeReq({ temperature, messages: [{ role: "user", content: "hi" }] });
    expect(() => parseRequest(req)).toThrow(/temperature/);
  });

  it.each([-5, 1.5, "1000", -0.5])("rejects invalid max_tokens %j", (max_tokens) => {
    const req = makeReq({ max_tokens, messages: [{ role: "user", content: "hi" }] });
    expect(() => parseRequest(req)).toThrow(/max_tokens/);
  });

  it("rejects max_tokens above the hard ceiling", () => {
    const req = makeReq({ max_tokens: 1_000_000, messages: [{ role: "user", content: "hi" }] });
    expect(() => parseRequest(req)).toThrow(/max_tokens/);
  });

  it("still accepts a fully valid request", () => {
    const req = makeReq({
      model: "gpt-4o",
      temperature: 0.7,
      max_tokens: 512,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    const context = parseRequest(req);
    expect(context.maxTokens).toBe(512);
    expect(context.temperature).toBe(0.7);
    expect(context.messages).toHaveLength(3);
  });

  it("forwards every parsed message to the provider (no silent drop)", () => {
    const context = makeContext({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    });
    const decision = { selectedProvider: "openai", selectedModel: "gpt-4o", fallbackUsed: false, alternatives: [] } as RoutingDecision;
    const providerRequest = buildProviderRequest(context, decision);
    expect(providerRequest.messages).toHaveLength(4);
  });
});

describe("F3: budget reservation includes bounded output estimate", () => {
  const model = "gpt-4o";
  const pricing = getModelInfo(model)!.pricing;

  it("reserves min(maxTokens, model output ceiling) of output spend", () => {
    const context = makeContext({ originalModel: model, maxTokens: 100 });
    const estimate = estimateRequestCost(context);
    const inputOnly = countMessageTokens(context.messages) * pricing.inputPerToken;
    expect(estimate).toBeCloseTo(inputOnly + 100 * pricing.outputPerToken, 12);
    expect(estimate).toBeGreaterThan(inputOnly);
  });

  it("caps the reservation at the model's maxOutputTokens", () => {
    const ceiling = getModelInfo(model)!.maxOutputTokens;
    const context = makeContext({ originalModel: model, maxTokens: ceiling * 4 });
    const estimate = estimateRequestCost(context);
    const inputOnly = countMessageTokens(context.messages) * pricing.inputPerToken;
    expect(estimate).toBeCloseTo(inputOnly + ceiling * pricing.outputPerToken, 12);
  });

  it("reserves the full output ceiling when max_tokens is undeclared", () => {
    const context = makeContext({ originalModel: model });
    const estimate = estimateRequestCost(context);
    const inputOnly = countMessageTokens(context.messages) * pricing.inputPerToken;
    expect(estimate).toBeCloseTo(
      inputOnly + getModelInfo(model)!.maxOutputTokens * pricing.outputPerToken,
      12
    );
  });

  it("falls back to a fixed output estimate for uncataloged models", () => {
    const context = makeContext({ originalModel: "unknown-model", maxTokens: 50 });
    expect(estimateRequestCost(context)).toBeGreaterThan(0);
  });
});
