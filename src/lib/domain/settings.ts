import type { Queryable } from "@/lib/db";
import { DomainError } from "@/lib/errors";

export async function getSetting<T = any>(c: Queryable, key: string, fallback?: T): Promise<T> {
  const r = await c.query<{ value: T }>("select value from system_settings where key = $1", [key]);
  if (r.rows[0]) return r.rows[0].value;
  if (fallback !== undefined) return fallback;
  throw new DomainError("CONFIG", `Missing system setting: ${key}`);
}

export async function setSetting(c: Queryable, key: string, value: unknown, userId: string | null) {
  await c.query(
    `insert into system_settings(key, value, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
}

export interface FeatureGate { enabled: boolean; legal_review_ref: string | null; [k: string]: unknown }

/**
 * Legal gate for regulated features (buyback, automated reallocation, event resale).
 * A feature is only ON when an administrator has switched it on AND recorded a legal-review reference.
 */
export async function featureOn(c: Queryable, key: "features.buyback" | "features.auto_reallocation" | "features.event_resale"): Promise<boolean> {
  const g = await getSetting<FeatureGate>(c, key, { enabled: false, legal_review_ref: null });
  return g.enabled === true && !!g.legal_review_ref;
}
