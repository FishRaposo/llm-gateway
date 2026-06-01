/** Cache adapter - implements CachePort using existing CacheStore.
 * Infrastructure layer - wraps external storage with domain interface.
 */

import type { CachePort } from "../../domain/ports/CachePort";
import { CacheStore } from "../../storage/cacheStore";

interface CachedWrapper<T> {
  data: T;
  timestamp: number;
}

export class CacheAdapter implements CachePort {
  private store: CacheStore;

  constructor(redisUrl: string) {
    this.store = new CacheStore(redisUrl);
  }

  async get<T>(key: string): Promise<T | null> {
    const result = await this.store.get(key);
    if (!result) return null;
    // The CacheStore wraps responses in { response, timestamp }
    return (result as unknown as CachedWrapper<T>).data ?? null;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // Convert ms to seconds for CacheStore
    const ttlSeconds = ttlMs ? Math.floor(ttlMs / 1000) : 3600;
    await this.store.set(key, { response: value as Record<string, unknown>, timestamp: Date.now() }, ttlSeconds);
  }

  async invalidate(pattern: string): Promise<void> {
    await this.store.invalidate(pattern);
  }

  async ping(): Promise<boolean> {
    return this.store.ping();
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}
