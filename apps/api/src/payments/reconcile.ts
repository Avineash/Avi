import { tenant } from '../db.js';
import { HttpError } from '../auth.js';
import { audit, type Actor } from '../audit.js';
import type { PaymentService } from './service.js';

export interface ReconItem { ref: string; kind: string; detail: string; local?: any; provider?: any }

const COLOMBO = '+05:30';
export const dayStart = (d: string) => new Date(`${d}T00:00:00${COLOMBO}`);
export const dayAfter = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);

/**
 * Compares our payments against the provider's own transaction list for a period.
 *  • provider says paid, we don't  → we apply it (self-heals a lost webhook) and report it
 *  • we say paid, provider doesn't → flagged for investigation (never auto-reversed)
 *  • amount / refund mismatches    → flagged
 *  • provider settlement info      → recorded on our payment (settlement_status = settled)
 */
export async function reconcile(svc: PaymentService, a: { restaurantId: string; provider: string; from: string; to: string; actor: Actor }) {
  const scope = tenant(a.restaurantId);
  const provider = svc.provider(a.provider);
  if (!provider) throw new HttpError(404, 'unknown_provider');
  if (!provider.listTransactions || !provider.capabilities.transactionListing)
    throw new HttpError(422, 'unsupported', 'This provider has no transaction-listing API. Import its settlement report instead.');
  const lc = await svc.db.tx(scope, (q) => svc.loadCtx(q, a.restaurantId, provider.method, a.provider));
  if (!lc) throw new HttpError(409, 'not_configured', 'Provider is not configured for this restaurant');

  const from = dayStart(a.from), to = dayAfter(a.to);
  const remote = await provider.listTransactions(lc.ctx, from, to);
  const local = await svc.db.tx(scope, (q) => q.query(
    `select * from payments where provider = $1 and provider_ref is not null and created_at >= $2 and created_at < $3`, [a.provider, from, to]));
  const items: ReconItem[] = [];
  const byRef = new Map(local.map((p: any) => [p.provider_ref, p]));
  const seen = new Set<string>();
  let matched = 0, healed = 0, settled = 0;

  for (const r of remote) {
    const p: any = byRef.get(r.providerRef);
    // The simulated provider is global, so only consider rows belonging to this restaurant.
    if (!p) { if (!(r as any).foreign) items.push({ ref: r.providerRef, kind: 'unknown_locally', detail: 'Provider has a transaction we have no record of', provider: r }); continue; }
    seen.add(r.providerRef);
    const localPaid = p.status === 'paid' || p.status === 'paid_duplicate';
    if (r.state === 'paid' && !localPaid) {
      await svc.applyStatus(a.restaurantId, p.id, { state: 'paid', amountCents: r.amountCents, feeCents: r.feeCents });
      items.push({ ref: r.providerRef, kind: 'healed', detail: 'Provider captured the payment but no webhook was processed; applied now', local: p.status, provider: r.state });
      healed++; continue;
    }
    if (localPaid && r.state !== 'paid') { items.push({ ref: r.providerRef, kind: 'paid_locally_not_at_provider', detail: 'We recorded payment but the provider does not show it as captured', local: p.status, provider: r.state }); continue; }
    if (localPaid && r.amountCents !== p.amount_cents) { items.push({ ref: r.providerRef, kind: 'amount_mismatch', detail: `Provider ${r.amountCents} vs ours ${p.amount_cents}` }); continue; }
    if (localPaid && r.refundedCents !== p.refunded_cents) { items.push({ ref: r.providerRef, kind: 'refund_mismatch', detail: `Provider refunded ${r.refundedCents} vs ours ${p.refunded_cents}` }); continue; }
    if (localPaid && r.settledAt && p.settlement_status !== 'settled') {
      await svc.db.tx(scope, (q) => q.query(`update payments set settlement_status = 'settled', settled_at = $2, settlement_ref = $3 where id = $1`, [p.id, r.settledAt, r.settlementRef ?? null]));
      settled++;
    }
    matched++;
  }
  for (const p of local as any[]) {
    if ((p.status === 'paid' || p.status === 'paid_duplicate') && !seen.has(p.provider_ref))
      items.push({ ref: p.provider_ref, kind: 'missing_at_provider', detail: 'Paid locally but absent from provider list' });
  }
  const status = items.some((i) => i.kind !== 'healed') ? 'discrepancies' : 'clean';
  const summary = { providerTxns: remote.length, localPayments: local.length, matched, healed, newlySettled: settled, discrepancies: items.filter((i) => i.kind !== 'healed').length };
  return svc.db.tx(scope, async (q) => {
    const run = await q.one(
      `insert into reconciliation_runs (restaurant_id, provider, period_from, period_to, status, summary, items, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [a.restaurantId, a.provider, a.from, a.to, status, JSON.stringify(summary), JSON.stringify(items), a.actor.id ?? null]);
    await audit(q, a.restaurantId, a.actor, 'reconciliation.run', 'reconciliation', run.id, summary);
    return run;
  });
}
