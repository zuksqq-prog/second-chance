/**
 * Token-bucket rate limiter. Used both for inbound API protection (per IP /
 * per wallet) and outbound pacing toward upstream providers.
 */
export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private now: () => number = Date.now,
  ) {}

  take(key: string, cost = 1): { ok: boolean; retryAfterMs: number } {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    const elapsed = (t - b.updated) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.updated = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      this.buckets.set(key, b);
      return { ok: true, retryAfterMs: 0 };
    }
    this.buckets.set(key, b);
    return { ok: false, retryAfterMs: Math.ceil(((cost - b.tokens) / this.refillPerSecond) * 1000) };
  }

  /** Wait until a token is available (outbound pacing). */
  async acquire(key: string, maxWaitMs = 10_000): Promise<void> {
    const started = this.now();
    for (;;) {
      const r = this.take(key);
      if (r.ok) return;
      if (this.now() - started + r.retryAfterMs > maxWaitMs) throw new Error("Upstream rate limit: try again shortly.");
      await new Promise((res) => setTimeout(res, r.retryAfterMs));
    }
  }
}

// Inbound limits (per IP or wallet)
export const apiLimiter = new TokenBucketLimiter(60, 2); // bursts of 60, 2 req/s sustained
export const tradeLimiter = new TokenBucketLimiter(10, 0.2); // trades: burst 10, 1 per 5s sustained

// Outbound pacing. DexScreener ~300/min on pair endpoints, 60/min on profiles.
// GeckoTerminal public API ~30/min. Jupiter keyless 0.5 rps, free key 1 rps.
export const upstream = {
  dexscreener: new TokenBucketLimiter(20, 4.5),
  dexscreenerProfiles: new TokenBucketLimiter(5, 0.9),
  geckoterminal: new TokenBucketLimiter(5, 0.45),
  jupiter: new TokenBucketLimiter(2, 0.5),
};
