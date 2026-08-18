// Lightweight in-memory sliding-window rate limiter.
// Single-instance only — replace with Redis for multi-node deployments.
interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { allowed: true, remaining: limit - b.count, retryAfterSeconds: 0 };
}

export function clientKey(request: Request, scope: string): string {
  const h = request.headers;
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown';
  return `${scope}:${ip}`;
}

// Test-only helper.
export function __resetRateLimit(): void { buckets.clear(); }
