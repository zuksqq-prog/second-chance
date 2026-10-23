/**
 * TTL cache with in-flight request deduplication.
 * Concurrent callers for the same key share one upstream request.
 * Per-instance memory; on serverless each instance has its own cache, which
 * still cuts upstream load substantially. Swap for Redis (see DEPLOY.md) when
 * running multiple long-lived instances.
 */
export class TtlCache {
  private store = new Map<string, { value: unknown; expires: number }>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(private maxEntries = 2000, private now: () => number = Date.now) {}

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expires > this.now()) return hit.value as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = load()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Return a cached value even if expired (stale-if-error), or undefined. */
  peek<T>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  set(key: string, value: unknown, ttlMs: number) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: this.now() + ttlMs });
  }
}

export const sharedCache = new TtlCache();
