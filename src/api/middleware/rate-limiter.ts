import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyExtractor?: (c: Context) => string;
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
  requestTimestamps: number[];
}

const FALLBACK_KEY = "ip:unknown";

export function createRateLimiter(config: RateLimitConfig): MiddlewareHandler {
  const windowMs = normalizePositiveInteger(config.windowMs, 60_000);
  const maxRequests = normalizePositiveInteger(config.maxRequests, 100);
  const keyExtractor = config.keyExtractor ?? defaultKeyExtractor;
  const refillRatePerMs = maxRequests / windowMs;
  const buckets = new Map<string, BucketState>();

  return async (c, next) => {
    const now = Date.now();
    const key = getKey(c, keyExtractor);
    const bucket = buckets.get(key) ?? {
      tokens: maxRequests,
      lastRefillAt: now,
      requestTimestamps: [],
    };

    refillBucket(bucket, now, maxRequests, refillRatePerMs);
    trimWindow(bucket, now, windowMs);

    const hasToken = bucket.tokens >= 1;
    const withinSlidingWindow = bucket.requestTimestamps.length < maxRequests;
    if (!hasToken || !withinSlidingWindow) {
      const retryAfterSeconds = estimateRetryAfterSeconds(bucket, now, windowMs, refillRatePerMs);
      c.header("Retry-After", String(retryAfterSeconds));
      buckets.set(key, bucket);
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "Too Many Requests",
        },
        429,
      );
    }

    bucket.tokens -= 1;
    bucket.requestTimestamps.push(now);
    buckets.set(key, bucket);

    await next();
  };
}

function defaultKeyExtractor(c: Context): string {
  const apiKey = c.req.header("x-api-key")?.trim();
  if (apiKey) {
    return `api:${apiKey}`;
  }

  const forwardedFor = c.req.header("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim();
  if (clientIp) {
    return `ip:${clientIp}`;
  }

  const directIp = c.req.header("x-real-ip") ?? c.req.header("cf-connecting-ip");
  if (directIp) {
    return `ip:${directIp.trim()}`;
  }

  return FALLBACK_KEY;
}

function getKey(c: Context, extractor: (c: Context) => string): string {
  try {
    const extracted = extractor(c)?.trim();
    if (extracted) {
      return extracted;
    }
  } catch {
    // Fall back to default key when key extraction fails.
  }
  return defaultKeyExtractor(c);
}

function refillBucket(
  bucket: BucketState,
  now: number,
  maxRequests: number,
  refillRatePerMs: number,
): void {
  const elapsedMs = now - bucket.lastRefillAt;
  if (elapsedMs <= 0) {
    return;
  }

  bucket.tokens = Math.min(maxRequests, bucket.tokens + elapsedMs * refillRatePerMs);
  bucket.lastRefillAt = now;
}

function trimWindow(bucket: BucketState, now: number, windowMs: number): void {
  const windowStart = now - windowMs;
  while (bucket.requestTimestamps.length > 0) {
    const firstTimestamp = bucket.requestTimestamps[0];
    if (firstTimestamp === undefined || firstTimestamp > windowStart) {
      break;
    }
    bucket.requestTimestamps.shift();
  }
}

function estimateRetryAfterSeconds(
  bucket: BucketState,
  now: number,
  windowMs: number,
  refillRatePerMs: number,
): number {
  const firstTimestamp = bucket.requestTimestamps[0];
  const untilWindowOpensMs =
    firstTimestamp !== undefined ? Math.max(0, firstTimestamp + windowMs - now) : 0;

  const missingTokens = bucket.tokens >= 1 ? 0 : 1 - bucket.tokens;
  const untilTokenRefillMs = missingTokens > 0 ? Math.ceil(missingTokens / refillRatePerMs) : 0;

  const retryAfterMs = Math.max(untilWindowOpensMs, untilTokenRefillMs, 1);
  return Math.max(1, Math.ceil(retryAfterMs / 1_000));
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
