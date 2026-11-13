import type { Queryable, Tx } from "@/lib/db";
import { getSetting } from "./settings";
import { DomainError } from "@/lib/errors";
import { TZ, melbDay } from "@/lib/util";

export interface PricingContext {
  listingId: string;
  category: string;
  originalCents: number; minCents: number; maxCents: number;
  startsAt: Date; now: Date;
  totalUnits: number; availableUnits: number;
  waitlistCount: number; bookingsLastWindow: (hours: number) => number;
  specialEventMultiplier: number; specialEventName: string | null;
}
export interface Adjustment { rule: string; multiplier: number; reason: string }
export interface PriceSuggestion {
  suggestedCents: number; rawCents: number; originalCents: number;
  multiplier: number; adjustments: Adjustment[]; clampedBy: "min" | "max" | null; model: string;
}
export type RuleSet = Partial<Record<"time_decay" | "scarcity" | "demand" | "velocity" | "day_of_week" | "seasonal", any>>;
/** Predictive models (Phase 4+) implement this and can be swapped in via `registerPricingModel` / `useModel`. */
export interface PricingModel { name: string; suggest(ctx: PricingContext, rules: RuleSet, bounds: { min: number; max: number }): PriceSuggestion }

export const ruleBasedModel: PricingModel = {
  name: "rule-based-v1",
  suggest(ctx, rules, bounds) {
    const adj: Adjustment[] = [];
    const hoursToStart = (ctx.startsAt.getTime() - ctx.now.getTime()) / 3_600_000;

    if (rules.time_decay) {
      const tier = rules.time_decay.tiers.find((t: any) => hoursToStart <= t.max_hours);
      if (tier && tier.mult !== 1) adj.push({ rule: "time_decay", multiplier: tier.mult, reason: `${Math.max(0, Math.round(hoursToStart))}h before start` });
    }
    if (rules.scarcity && ctx.totalUnits > 0) {
      const ratio = ctx.availableUnits / ctx.totalUnits;
      const tier = rules.scarcity.tiers.find((t: any) => ratio <= t.max_ratio);
      if (tier && tier.mult !== 1) adj.push({ rule: "scarcity", multiplier: tier.mult, reason: `${ctx.availableUnits} of ${ctx.totalUnits} left` });
    }
    if (rules.demand && ctx.waitlistCount > 0) {
      const bps = Math.min(rules.demand.cap_bps, ctx.waitlistCount * rules.demand.per_waitlist_bps);
      adj.push({ rule: "demand", multiplier: 1 + bps / 10_000, reason: `${ctx.waitlistCount} on waitlist` });
    }
    if (rules.velocity) {
      const n = ctx.bookingsLastWindow(rules.velocity.window_hours);
      if (n > 0) adj.push({ rule: "velocity", multiplier: 1 + Math.min(rules.velocity.cap_bps, n * rules.velocity.per_booking_bps) / 10_000, reason: `${n} booked in ${rules.velocity.window_hours}h` });
    }
    if (rules.day_of_week) {
      const wd = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short" }).format(ctx.startsAt).toLowerCase().slice(0, 3);
      const m = rules.day_of_week.mult[wd];
      if (m && m !== 1) adj.push({ rule: "day_of_week", multiplier: m, reason: wd });
    }
    if (rules.seasonal) {
      const month = Number(melbDay(ctx.startsAt).slice(5, 7));
      const m = rules.seasonal.months[String(month)];
      if (m && m !== 1) adj.push({ rule: "seasonal", multiplier: m, reason: `month ${month}` });
    }
    if (ctx.specialEventMultiplier !== 1) adj.push({ rule: "special_event", multiplier: ctx.specialEventMultiplier, reason: ctx.specialEventName ?? "special event" });

    let multiplier = adj.reduce((p, a) => p * a.multiplier, 1);
    multiplier = Math.min(bounds.max, Math.max(bounds.min, multiplier));
    const raw = Math.round(ctx.originalCents * multiplier);
    let suggested = Math.round(raw / 100) * 100; // whole dollars
    let clampedBy: "min" | "max" | null = null;
    if (suggested < ctx.minCents) { suggested = ctx.minCents; clampedBy = "min"; }
    if (suggested > ctx.maxCents) { suggested = ctx.maxCents; clampedBy = "max"; }
    return { suggestedCents: suggested, rawCents: raw, originalCents: ctx.originalCents, multiplier, adjustments: adj, clampedBy, model: "rule-based-v1" };
  },
};

const models = new Map<string, PricingModel>([[ruleBasedModel.name, ruleBasedModel]]);
export function registerPricingModel(m: PricingModel) { models.set(m.name, m); }
let activeModel = ruleBasedModel.name;
export function useModel(name: string) { if (!models.has(name)) throw new Error(`Unknown pricing model ${name}`); activeModel = name; }

async function loadRules(c: Queryable, partnerId: string, listingId: string): Promise<RuleSet> {
  // listing > partner > global, per rule type
  const { rows } = await c.query<any>(
    `select rule_type, params, scope from pricing_rules
      where enabled and (scope = 'global' or (scope = 'partner' and partner_id = $1) or (scope = 'listing' and listing_id = $2))`,
    [partnerId, listingId]);
  const rank: Record<string, number> = { global: 1, partner: 2, listing: 3 };
  const out: RuleSet = {}; const best: Record<string, number> = {};
  for (const r of rows) if (!best[r.rule_type] || rank[r.scope] > best[r.rule_type]) { out[r.rule_type as keyof RuleSet] = r.params; best[r.rule_type] = rank[r.scope]; }
  return out;
}

export async function suggestPrice(c: Queryable, listingId: string, now = new Date()): Promise<PriceSuggestion> {
  const l = (await c.query<any>("select * from listings where id = $1", [listingId])).rows[0];
  if (!l) throw new DomainError("NOT_FOUND", "Listing not found");
  const av = (await c.query<any>("select total_units, available_units from listing_availability where listing_id = $1", [listingId])).rows[0];
  const wl = (await c.query<any>("select count(*)::int n from waitlist_entries where listing_id = $1 and status in ('active','offered')", [listingId])).rows[0].n;
  const recent = await c.query<any>("select created_at from reservations where listing_id = $1 and status in ('confirmed','completed') and created_at > $2", [listingId, new Date(now.getTime() - 72 * 3_600_000)]);
  const day = melbDay(l.starts_at);
  const ev = (await c.query<any>("select name, multiplier_bps from special_events where $1::date between starts_on and ends_on order by multiplier_bps desc limit 1", [day])).rows[0];
  const bounds = await getSetting(c, "pricing.bounds", { min_multiplier: 0.6, max_multiplier: 1.5 });
  const rules = await loadRules(c, l.partner_id, listingId);
  const ctx: PricingContext = {
    listingId, category: l.category, originalCents: l.original_price_cents, minCents: l.min_price_cents, maxCents: l.max_price_cents,
    startsAt: new Date(l.starts_at), now, totalUnits: av?.total_units ?? 0, availableUnits: av?.available_units ?? 0, waitlistCount: wl,
    bookingsLastWindow: (h) => recent.rows.filter((r) => new Date(r.created_at).getTime() > now.getTime() - h * 3_600_000).length,
    specialEventMultiplier: ev ? ev.multiplier_bps / 10_000 : 1, specialEventName: ev?.name ?? null,
  };
  return models.get(activeModel)!.suggest(ctx, rules, { min: bounds.min_multiplier, max: bounds.max_multiplier });
}

/** Partner override: fixed price within the partner's own min/max. Switches the listing to manual pricing. */
export async function setManualPrice(c: Queryable, listingId: string, cents: number) {
  const r = await c.query("update listings set current_price_cents = $2, pricing_mode = 'manual', updated_at = now() where id = $1 and min_price_cents <= $2 and max_price_cents >= $2 returning id", [listingId, cents]);
  if (!r.rows[0]) throw new DomainError("INVALID", "Price must be between your minimum and maximum selling price");
  await c.query("insert into price_history(listing_id, price_cents, source) values ($1,$2,'partner')", [listingId, cents]);
}

/** Re-price every auto-priced, open listing. Called by the maintenance job. */
export async function repriceAuto(tx: Tx, now = new Date()): Promise<number> {
  const { rows } = await tx.query<any>(
    "select id, current_price_cents from listings where pricing_mode = 'auto' and status = 'published' and booking_deadline > $1", [now]);
  let changed = 0;
  for (const l of rows) {
    const s = await suggestPrice(tx, l.id, now);
    if (s.suggestedCents !== l.current_price_cents) {
      await tx.query("update listings set current_price_cents = $2, updated_at = now() where id = $1", [l.id, s.suggestedCents]);
      await tx.query("insert into price_history(listing_id, price_cents, source, detail) values ($1,$2,'auto',$3::jsonb)", [l.id, s.suggestedCents, JSON.stringify({ adjustments: s.adjustments, model: s.model })]);
      changed++;
    }
  }
  return changed;
}
