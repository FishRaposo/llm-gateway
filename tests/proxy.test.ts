/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { parseRequest, buildProviderRequest, parseProviderResponse } from "../src/proxy/request";
import type { RoutingDecision } from "../src/types/routing";
import type { ProviderResponse } from "../src/types/provider";

describe("Proxy Handler", () => {
  describe("parseRequest", () => {
    it("should parse a valid request", () => {
      const req = {
        body: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: { authorization: "Bearer test-key" },
        ip: "127.0.0.1",
      } as any;

      const context = parseRequest(req);
      expect(context.apiKey).toBe("test-key");
      expect(context.originalModel).toBe("gpt-4o-mini");
      expect(context.messages).toHaveLength(1);
      expect(context.stream).toBe(false);
    });

    it("should throw on missing messages", () => {
      const req = {
        body: { model: "gpt-4o-mini" },
        headers: {},
      } as any;

      expect(() => parseRequest(req)).toThrow("messages must be a non-empty array");
    });

    it("should throw on empty messages", () => {
      const req = {
        body: { model: "gpt-4o-mini", messages: [] },
        headers: {},
      } as any;

      expect(() => parseRequest(req)).toThrow("messages must be a non-empty array");
    });

    it("should throw on invalid message format", () => {
      const req = {
        body: { messages: [{ content: "Hello" }] },
        headers: {},
      } as any;

      expect(() => parseRequest(req)).toThrow("role");
    });

    it("should default model to gpt-4o-mini", () => {
      const req = {
        body: { messages: [{ role: "user", content: "Hello" }] },
        headers: {},
      } as any;

      const context = parseRequest(req);
      expect(context.originalModel).toBe("gpt-4o-mini");
    });
  });

  describe("buildProviderRequest", () => {
    it("should transform context to provider request", () => {
      const context = {
        requestId: "test",
        apiKey: "key",
        apiKeyName: "test",
        originalModel: "gpt-4o",
        messages: [
          { role: "system" as const, content: "Be helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        stream: false,
        metadata: {},
        timestamp: new Date().toISOString(),
      };

      const decision: RoutingDecision = {
        selectedProvider: "openai",
        selectedModel: "gpt-4o",
        fallbackUsed: false,
        ruleMatched: "default",
        alternatives: [],
      };

      const providerReq = buildProviderRequest(context, decision);
      expect(providerReq.model).toBe("gpt-4o");
      expect(providerReq.messages).toHaveLength(2);
      expect(providerReq.messages[0].role).toBe("system");
    });
  });

  describe("parseProviderResponse", () => {
    it("should normalize provider response to gateway format", () => {
      const providerResponse: ProviderResponse = {
        id: "resp-123",
        model: "gpt-4o-mini",
        provider: "openai",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finishReason: "stop",
        }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };

      const decision: RoutingDecision = {
        selectedProvider: "openai",
        selectedModel: "gpt-4o-mini",
        fallbackUsed: false,
        ruleMatched: "default",
        alternatives: [],
      };

      const result = parseProviderResponse(providerResponse, decision, Date.now());
      expect(result.object).toBe("chat.completion");
      expect(result.choices).toHaveLength(1);
      expect(result.provider).toBe("openai");
      expect(result.cacheHit).toBe(false);
    });
  });
});
