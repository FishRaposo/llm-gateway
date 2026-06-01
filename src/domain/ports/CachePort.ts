/** Cache port - interface for caching layer.
 * Domain defines the contract, infrastructure implements it.
 */

export interface CachePort {
  get<T>(key: string): Promise<T | null>;

  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;

  invalidate(pattern: string): Promise<void>;

  ping(): Promise<boolean>;

  close(): Promise<void>;
}
