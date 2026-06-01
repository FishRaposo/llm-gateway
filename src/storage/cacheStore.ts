/** Cache storage using Redis for response caching. */

export interface CachedResponse {
  response: Record<string, unknown>;
  timestamp: number;
}

const inMemoryCache = new Map<string, { data: CachedResponse; expiresAt: number }>();

export class CacheStore {
  private redisUrl: string;
  private client: import("ioredis").Redis | null = null;

  /**
   * @param redisUrl - Redis connection URL.
   */
  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
  }

  /**
   * Gets or creates the Redis client connection.
   * @returns Redis client instance.
   */
  private async getClient(): Promise<import("ioredis").Redis | null> {
    if (this.client) return this.client;

    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      client.on("error", () => { /* suppress connection errors when Redis is unavailable */ });
      this.client = client;
      await client.ping().catch(() => {
        this.client = null;
        client.disconnect();
        return null;
      });
      return this.client;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves a cached response by key.
   * @param key - Cache key.
   * @returns Cached response or null if not found/expired.
   */
  async get(key: string): Promise<CachedResponse | null> {
    const redis = await this.getClient();

    if (redis) {
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data) as CachedResponse;
      }
      return null;
    }

    const entry = inMemoryCache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      inMemoryCache.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * Stores a response in the cache with a TTL.
   * @param key - Cache key.
   * @param response - Response to cache.
   * @param ttlSeconds - Time-to-live in seconds.
   */
  async set(key: string, response: CachedResponse, ttlSeconds: number = 3600): Promise<void> {
    const redis = await this.getClient();

    if (redis) {
      await redis.set(key, JSON.stringify(response), "EX", ttlSeconds);
      return;
    }

    inMemoryCache.set(key, {
      data: response,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Invalidates cache entries matching a key pattern.
   * @param pattern - Key pattern to invalidate (supports * wildcard in Redis).
   */
  async invalidate(pattern: string): Promise<void> {
    const redis = await this.getClient();

    if (redis) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      return;
    }

    for (const key of inMemoryCache.keys()) {
      if (key.includes(pattern.replace("*", ""))) {
        inMemoryCache.delete(key);
      }
    }
  }

  /**
   * Pings Redis to verify connectivity.
   * @returns True if Redis is reachable, false otherwise.
   */
  async ping(): Promise<boolean> {
    const redis = await this.getClient();
    if (!redis) return false;
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Closes the Redis connection.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
