/**
 * Rate limit em memória (token bucket por origem).
 * BLUEPRINT §3.3:
 *   - Por IP: 10/min, 100/h
 *   - Health: 60/min (não conta no limite global)
 *
 * Implementação: 2 buckets por chave (minute + hour). Em vez de buckets crescendo
 * indefinidamente, mantém estado mínimo (count + window_start) e refila ao detectar
 * janela nova.
 */

export interface RateLimitConfig {
  readonly perMinute: number;
  readonly perHour: number;
}

export interface RateLimitDecision {
  readonly allow: boolean;
  readonly retryAfterSeconds: number;
  readonly reason?: string;
}

interface BucketState {
  count: number;
  windowStart: number; // epoch ms
}

export class TokenBucketRateLimiter {
  private readonly minuteBuckets = new Map<string, BucketState>();
  private readonly hourBuckets = new Map<string, BucketState>();

  constructor(private readonly config: RateLimitConfig) {}

  check(key: string, now: number = Date.now()): RateLimitDecision {
    const minute = this.tickBucket(this.minuteBuckets, key, now, 60_000);
    if (minute.count > this.config.perMinute) {
      const retryMs = minute.windowStart + 60_000 - now;
      return {
        allow: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
        reason: `rate limit per minute (${this.config.perMinute}) exceeded`,
      };
    }
    const hour = this.tickBucket(this.hourBuckets, key, now, 3_600_000);
    if (hour.count > this.config.perHour) {
      const retryMs = hour.windowStart + 3_600_000 - now;
      return {
        allow: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
        reason: `rate limit per hour (${this.config.perHour}) exceeded`,
      };
    }
    return { allow: true, retryAfterSeconds: 0 };
  }

  /**
   * Limpa estado (testes / SIGHUP reload).
   */
  reset(): void {
    this.minuteBuckets.clear();
    this.hourBuckets.clear();
  }

  private tickBucket(
    buckets: Map<string, BucketState>,
    key: string,
    now: number,
    windowMs: number,
  ): BucketState {
    const state = buckets.get(key);
    if (state === undefined || now - state.windowStart >= windowMs) {
      const fresh: BucketState = { count: 1, windowStart: now };
      buckets.set(key, fresh);
      return fresh;
    }
    state.count += 1;
    return state;
  }
}
