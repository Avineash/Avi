/** Minimal circuit breaker: after `threshold` consecutive failures the provider is treated as
 *  unavailable for `coolMs`, so customers are steered to the fallback method immediately. */
export class Breaker {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(private threshold = 3, private coolMs = 60_000) {}
  isOpen(key: string, now = Date.now()) { const s = this.fails.get(key); return !!s && s.until > now; }
  failure(key: string, now = Date.now()) {
    const s = this.fails.get(key) ?? { n: 0, until: 0 };
    s.n += 1; if (s.n >= this.threshold) s.until = now + this.coolMs;
    this.fails.set(key, s);
  }
  success(key: string) { this.fails.delete(key); }
}
