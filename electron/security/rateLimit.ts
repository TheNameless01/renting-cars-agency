export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * In-memory sliding-window rate limiter for authentication & sensitive endpoints.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(options?: { windowMs?: number; maxAttempts?: number }) {
    this.windowMs = options?.windowMs ?? 5 * 60 * 1000;
    this.maxAttempts = options?.maxAttempts ?? 30;
  }

  consume(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (prev.length >= this.maxAttempts) {
      const oldest = prev[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, prev);
      return {
        allowed: false,
        retryAfterSeconds,
        remaining: 0,
      };
    }

    prev.push(now);
    this.hits.set(key, prev);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, this.maxAttempts - prev.length),
    };
  }

  reset(key?: string): void {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }
}
