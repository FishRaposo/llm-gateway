import { describe, it, expect, beforeEach } from "vitest";
import { CacheStore } from "../src/storage/cacheStore";
import { generateCacheKey } from "../src/middleware/cache";
import type { RequestContext } from "../src/types/routing";

const baseContext: RequestContext = {
  requestId: "test-1",
  apiKey: "test-key",
  apiKeyName: "test",
  originalModel: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }],
  stream: false,
  metadata: {},
  timestamp: new Date().toISOString(),
};

describe("Cache Middleware", () => {
  let cacheStore: CacheStore;

  beforeEach(() => {
    cacheStore = new CacheStore("redis://localhost:0");
  });

  it("should generate deterministic cache keys", () => {
    const key1 = generateCacheKey(baseContext);
    const key2 = generateCacheKey(baseContext);
    expect(key1).toBe(key2);
  });

  it("should generate different keys for different requests", () => {
    const context2 = { ...baseContext, originalModel: "gpt-4o" };
    const key1 = generateCacheKey(baseContext);
    const key2 = generateCacheKey(context2);
    expect(key1).not.toBe(key2);
  });

  it("should return null for cache miss", async () => {
    const result = await cacheStore.get("nonexistent-key");
    expect(result).toBeNull();
  });

  it("should store and retrieve cached responses", async () => {
    const key = "test-cache-key";
    const response = { id: "resp-1", model: "gpt-4o-mini", provider: "openai" };
    await cacheStore.set(key, { response, timestamp: Date.now() }, 3600);
    const cached = await cacheStore.get(key);
    expect(cached).not.toBeNull();
    expect(cached!.response.id).toBe("resp-1");
  });

  it("should respect TTL and expire entries", async () => {
    const key = "test-ttl-key";
    await cacheStore.set(key, { response: { data: "test" }, timestamp: Date.now() }, 0);
    const result = await cacheStore.get(key);
    expect(result).toBeNull();
  });

  it("should invalidate cache by pattern", async () => {
    await cacheStore.set("cache:abc", { response: { id: "1" }, timestamp: Date.now() }, 3600);
    await cacheStore.set("cache:def", { response: { id: "2" }, timestamp: Date.now() }, 3600);
    await cacheStore.invalidate("cache:*");
  });
});
