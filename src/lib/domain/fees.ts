import type { Queryable } from "@/lib/db";
import { DomainError } from "@/lib/errors";

export type FeePayer = "partner" | "customer" | "seller";
export type FeeFlow = "booking" | "buyback" | "resale" | "peer_resale";

export interface FeeRule {
  id: string; payer: FeePayer; applies_to: FeeFlow; scope: "global" | "category" | "partner";
  category: string | null; partner_id: string | null; kind: "percentage" | "fixed" | "percent_plus_fixed";
  rate_bps: number; fixed_cents: number; min_cents: number; max_cents: number | null;
}

/** Most specific active rule wins: partner > category > global. Throws if nothing is configured (fail closed). */
export async function resolveFeeRule(c: Queryable, a: { payer: FeePayer; flow: FeeFlow; category: string; partnerId: string }): Promise<FeeRule> {
  const { rows } = await c.query<FeeRule>(
    `select * from fee_rules
      where active and payer = $1 and applies_to = $2
        and ((scope = 'partner' and partner_id = $3) or (scope = 'category' and category = $4) or scope = 'global')
      order by case scope when 'partner' then 1 when 'category' then 2 else 3 end limit 1`,
    [a.payer, a.flow, a.partnerId, a.category],
  );
  if (!rows[0]) throw new DomainError("CONFIG", `No ${a.payer} fee rule configured for ${a.flow}/${a.category}`);
  return rows[0];
}

export function computeFee(rule: Pick<FeeRule, "kind" | "rate_bps" | "fixed_cents" | "min_cents" | "max_cents">, basisCents: number): number {
  let fee = 0;
  if (rule.kind === "percentage") fee = Math.round((basisCents * rule.rate_bps) / 10_000);
  else if (rule.kind === "fixed") fee = rule.fixed_cents;
  else fee = Math.round((basisCents * rule.rate_bps) / 10_000) + rule.fixed_cents;
  fee = Math.max(fee, rule.min_cents);
  if (rule.max_cents != null) fee = Math.min(fee, rule.max_cents);
  return Math.max(0, fee);
}

/** GST component of a GST-inclusive amount (Australia: 1/11). */
export const gstOf = (inclusiveCents: number) => Math.round(inclusiveCents / 11);

export async function quoteFee(c: Queryable, a: { payer: FeePayer; flow: FeeFlow; category: string; partnerId: string; basisCents: number }) {
  const rule = await resolveFeeRule(c, a);
  const amount = computeFee(rule, a.basisCents);
  return { rule, amount, gst: gstOf(amount) };
}

export function describeRule(r: Pick<FeeRule, "kind" | "rate_bps" | "fixed_cents">): string {
  const pct = `${(r.rate_bps / 100).toFixed(r.rate_bps % 100 ? 2 : 0)}%`;
  const fx = `$${(r.fixed_cents / 100).toFixed(2)}`;
  return r.kind === "percentage" ? pct : r.kind === "fixed" ? fx : `${pct} + ${fx}`;
}

/** Rule book for synchronous fee display (cards, previews). Resolution order matches resolveFeeRule: partner > category > global. */
export async function feeBook(c: Queryable, payer: FeePayer, flow: FeeFlow) {
  const rules = (await c.query<FeeRule>("select * from fee_rules where active and payer = $1 and applies_to = $2", [payer, flow])).rows;
  return (category: string, partnerId: string | null, basis: number) => {
    const r = rules.find((x) => x.scope === "partner" && x.partner_id === partnerId) ?? rules.find((x) => x.scope === "category" && x.category === category) ?? rules.find((x) => x.scope === "global");
    return r ? computeFee(r, basis) : 0;
  };
}
