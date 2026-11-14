import { getDb, inTx, type Queryable } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { aud } from "@/lib/util";
import { audit, type Actor } from "./audit";
import { notify, notifyPartnerOwner } from "./notifications";
import { applyRefundAccounting, issueManualRefund } from "./booking";
import { providerByName } from "@/lib/providers/payments";
import { randomUUID } from "node:crypto";

// ───────────── Partner payouts ─────────────
/** Sweeps all payable ledger entries (finished/cancelled bookings and adjustments) into a payout. Negative balances carry forward. */
export async function runPayout(partnerId: string, actor: Actor) {
  const created = await inTx(async (tx) => {
    const p = (await tx.query<any>("select * from partners where id = $1 for update", [partnerId])).rows[0];
    if (!p || p.status !== "approved") throw new DomainError("CONFLICT", "Partner is not approved");
    const e = (await tx.query<any>(
      `select e.* from ledger_entries e left join reservations r on r.id = e.reservation_id
        where e.partner_id = $1 and e.payout_id is null and (e.reservation_id is null or r.status in ('completed','cancelled')) for update of e`, [partnerId])).rows;
    if (!e.length) return null;
    const sum = (f: (x: any) => boolean) => e.filter(f).reduce((a, x) => a + Number(x.amount_cents), 0);
    const net = sum(() => true);
    if (net <= 0) return null;
    const payout = (await tx.query<any>(
      `insert into partner_payouts(partner_id, gross_cents, fees_cents, adjustments_cents, net_cents, entries_count, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [partnerId, sum((x) => x.kind === "sale"), sum((x) => ["commission", "commission_reversal"].includes(x.kind)),
       sum((x) => !["sale", "commission", "commission_reversal"].includes(x.kind)), net, e.length, `payout:${randomUUID()}`])).rows[0];
    await tx.query("update ledger_entries set payout_id = $2 where id = any($1::bigint[])", [e.map((x) => x.id), payout.id]);
    await audit(tx, actor, "payout.created", "partner_payout", payout.id, { net });
    return payout;
  });
  if (!created) return null;
  return sendPayout(created.id);
}

export async function sendPayout(payoutId: string) {
  const db = await getDb();
  const p = (await db.query<any>("select po.*, pa.stripe_account_id, pa.owner_user_id from partner_payouts po join partners pa on pa.id = po.partner_id where po.id = $1", [payoutId])).rows[0];
  if (!p || p.status === "paid") return p;
  const provider = providerByName(process.env.STRIPE_SECRET_KEY ? "stripe" : "sandbox");
  try {
    const t = await provider.transferToPartner({ stripeAccountId: p.stripe_account_id, amountCents: Number(p.net_cents), idempotencyKey: p.idempotency_key });
    await inTx(async (tx) => {
      await tx.query("update partner_payouts set status = 'paid', provider_ref = $2, paid_at = now() where id = $1", [payoutId, t.ref]);
      await notify(tx, p.owner_user_id, { kind: "payout", title: "Payout sent", body: `${aud(p.net_cents)} is on its way to your account.`, link: "/partner/earnings" });
    });
  } catch (e) {
    await db.query("update partner_payouts set status = 'failed' where id = $1", [payoutId]);
    await db.query("insert into integration_events(integration, level, message) values ('payments','error',$1)", [`payout ${payoutId} failed: ${e}`]);
  }
  return (await db.query<any>("select * from partner_payouts where id = $1", [payoutId])).rows[0];
}

export async function partnerBalance(c: Queryable, partnerId: string) {
  const r = (await c.query<any>(
    `select coalesce(sum(e.amount_cents) filter (where e.payout_id is null and (e.reservation_id is null or r.status in ('completed','cancelled'))),0)::bigint as payable,
            coalesce(sum(e.amount_cents) filter (where e.payout_id is null and r.status = 'confirmed'),0)::bigint as pending,
            coalesce(sum(e.amount_cents) filter (where e.payout_id is not null),0)::bigint as paid_out
       from ledger_entries e left join reservations r on r.id = e.reservation_id where e.partner_id = $1`, [partnerId])).rows[0];
  return { payable: Number(r.payable), pending: Number(r.pending), paidOut: Number(r.paid_out) };
}

// ───────────── Refund requests (exceptional refunds need admin approval) ─────────────
export async function requestRefund(a: { customerId: string; reservationId: string; amountCents: number; reason: string }) {
  return inTx(async (tx) => {
    const r = (await tx.query<any>("select * from reservations where id = $1", [a.reservationId])).rows[0];
    if (!r || r.customer_id !== a.customerId) throw new DomainError("NOT_FOUND", "Booking not found");
    if (a.reason.trim().length < 10) throw new DomainError("INVALID", "Please explain what went wrong (at least 10 characters)");
    const used = Number((await tx.query<any>("select coalesce(sum(amount_cents),0) s from refunds where reservation_id = $1 and status <> 'failed'", [r.id])).rows[0].s);
    if (a.amountCents <= 0 || a.amountCents > r.total_cents - used) throw new DomainError("INVALID", `You can request up to ${aud(r.total_cents - used)}`);
    const id = (await tx.query<any>("insert into refund_requests(reservation_id, requested_by, amount_cents, reason) values ($1,$2,$3,$4) returning id", [r.id, a.customerId, a.amountCents, a.reason])).rows[0].id;
    await audit(tx, { id: a.customerId, role: "customer" }, "refund_request.created", "refund_request", id, { amountCents: a.amountCents });
    return id as string;
  });
}

export async function decideRefundRequest(a: { id: string; approve: boolean; actor: Actor; note?: string }) {
  const rr = await inTx(async (tx) => {
    const r = (await tx.query<any>("select * from refund_requests where id = $1 for update", [a.id])).rows[0];
    if (!r || r.status !== "pending") throw new DomainError("CONFLICT", "Request already decided");
    await tx.query("update refund_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1", [a.id, a.approve ? "approved" : "rejected", a.actor.id, a.note ?? null]);
    if (!a.approve) await notify(tx, r.requested_by, { kind: "refund", title: "Refund request reviewed", body: a.note ?? "We reviewed your request and couldn't approve a refund. You can contact support to discuss.", link: "/account/payments" });
    await audit(tx, a.actor, a.approve ? "refund_request.approved" : "refund_request.rejected", "refund_request", a.id);
    return r;
  });
  if (a.approve) await issueManualRefund({ reservationId: rr.reservation_id, amountCents: rr.amount_cents, reason: `Approved refund request: ${rr.reason}`, actor: a.actor, idempotencyKey: `rr:${a.id}`, kind: "goodwill" });
}

// ───────────── Disputes / chargebacks ─────────────
export async function openDispute(a: { reservationId: string; kind: "dispute" | "chargeback" | "fraud"; amountCents: number; notes: string; actor: Actor }) {
  return inTx(async (tx) => {
    const r = (await tx.query<any>("select r.*, p.id as payment_id from reservations r join payments p on p.order_id = r.order_id where r.id = $1", [a.reservationId])).rows[0];
    if (!r) throw new DomainError("NOT_FOUND", "Booking not found");
    const id = (await tx.query<any>("insert into disputes(reservation_id, payment_id, kind, amount_cents, opened_by, notes) values ($1,$2,$3,$4,$5,$6) returning id", [r.id, r.payment_id, a.kind, a.amountCents, a.actor.id, a.notes])).rows[0].id;
    await notifyPartnerOwner(tx, r.partner_id, { kind: "dispute", title: "Payment dispute opened", body: `A ${a.kind} was opened on ${r.reference} for ${aud(a.amountCents)}.`, link: "/partner/reservations" });
    await audit(tx, a.actor, "dispute.opened", "dispute", id, { kind: a.kind, amountCents: a.amountCents });
    return id as string;
  });
}

/** Lost chargebacks are debited from the partner ledger; won/closed ones cost nothing. */
export async function resolveDispute(a: { id: string; outcome: "won" | "lost" | "closed"; resolution: string; actor: Actor }) {
  await inTx(async (tx) => {
    const d = (await tx.query<any>("select * from disputes where id = $1 for update", [a.id])).rows[0];
    if (!d || ["won", "lost", "closed"].includes(d.status)) throw new DomainError("CONFLICT", "Dispute already resolved");
    await tx.query("update disputes set status = $2, resolution = $3, resolved_at = now() where id = $1", [a.id, a.outcome, a.resolution]);
    if (a.outcome === "lost") {
      const pay = (await tx.query<any>("select * from payments where id = $1 for update", [d.payment_id])).rows[0];
      const amt = Math.min(d.amount_cents, pay.captured_cents - pay.refunded_cents);
      if (amt > 0) {
        const fr = (await tx.query<any>(
          `insert into refunds(payment_id, reservation_id, amount_cents, kind, reason, status, provider_ref, idempotency_key, completed_at)
           values ($1,$2,$3,'chargeback',$4,'succeeded',$5,$6,now()) returning *`, [pay.id, d.reservation_id, amt, `Dispute lost: ${a.resolution}`, `chargeback:${d.id}`, `cb:${d.id}`])).rows[0];
        const refunded = pay.refunded_cents + amt;
        await tx.query("update payments set refunded_cents = $2, status = $3 where id = $1", [pay.id, refunded, refunded >= pay.captured_cents ? "refunded" : "partially_refunded"]);
        await applyRefundAccounting(tx, fr);
      }
    }
    await audit(tx, a.actor, "dispute.resolved", "dispute", a.id, { outcome: a.outcome });
  });
}

// ───────────── Reviews ─────────────
export async function submitReview(a: { customerId: string; reservationId: string; rating: number; comment?: string }) {
  return inTx(async (tx) => {
    const r = (await tx.query<any>("select r.*, l.venue_id from reservations r join listings l on l.id = r.listing_id where r.id = $1", [a.reservationId])).rows[0];
    if (!r || r.customer_id !== a.customerId) throw new DomainError("NOT_FOUND", "Booking not found");
    if (r.status !== "completed") throw new DomainError("CONFLICT", "You can review a booking after the stay/event has finished");
    if (a.rating < 1 || a.rating > 5) throw new DomainError("INVALID", "Rating must be 1–5");
    try {
      await tx.query("insert into reviews(reservation_id, venue_id, customer_id, rating, comment) values ($1,$2,$3,$4,$5)", [r.id, r.venue_id, a.customerId, Math.round(a.rating), a.comment?.slice(0, 1500) ?? null]);
    } catch (e: any) { if (e?.code === "23505") throw new DomainError("CONFLICT", "You've already reviewed this booking"); throw e; }
  });
}

// ───────────── Reconciliation ─────────────
/** Cash identity: captured − refunded − compensation == Σ partner ledger + Σ seller ledger (incl. escrow) + Σ platform fees. Must always hold. */
export async function reconcile(c: Queryable) {
  const n = async (sql: string) => Number((await c.query<any>(sql)).rows[0].s);
  const captured = await n("select coalesce(sum(captured_cents),0)::bigint s from payments");
  const refunded = await n("select coalesce(sum(amount_cents),0)::bigint s from refunds where status = 'succeeded'");
  const compensation = await n("select coalesce(sum(amount_cents),0)::bigint s from compensation_payments");
  const ledger = await n("select coalesce(sum(amount_cents),0)::bigint s from ledger_entries");
  const fees = await n("select coalesce(sum(amount_cents),0)::bigint s from platform_fees");
  const paidOut = await n("select coalesce(sum(net_cents),0)::bigint s from partner_payouts where status = 'paid'");
  const sellerLedger = await n("select coalesce(sum(amount_cents),0)::bigint s from seller_ledger");
  const held = captured - refunded - compensation;
  return { captured, refunded, compensation, partnerLedger: ledger, sellerLedger, platformFees: fees, paidOut, cashHeld: held, difference: held - (ledger + sellerLedger + fees), balanced: held === ledger + sellerLedger + fees };
}
