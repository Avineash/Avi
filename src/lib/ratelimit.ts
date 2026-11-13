import { DomainError } from "./errors";

/** Fixed-window in-memory limiter. For multi-instance production swap the Map for Redis/Upstash (same interface). */
type G = typeof globalThis & { __eh_rl?: Map<string, { n: number; reset: number }> };
const buckets = ((globalThis as G).__eh_rl ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number) {
  if (process.env.NODE_ENV === "test") return;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++b.n > limit) throw new DomainError("RATE_LIMITED", "Too many attempts — please wait a minute and try again.");
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}
