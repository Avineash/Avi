import { getDb, inTx, type Queryable, type Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { aud, fmtDateTime } from "@/lib/util";
import { transition } from "./inventory";
import { featureOn, getSetting } from "./settings";
import { quoteFee } from "./fees";
import { customerFeeFlow, partnerFeeFlow } from "./orders";
import { notify, notifyPartnerOwner, flushNotifications } from "./notifications";
import { reofferUnit } from "./waitlist";
import { settleRefund } from "./booking";
import { buybackOfferText } from "./legal";
import { audit, SYSTEM, type Actor } from "./audit";
import { providerByName } from "@/lib/providers/payments";

/*
 * BUYBACK — the one place where a booked unit can change hands.
 *
 * Hard rules (all enforced below and covered by tests/buyback.test.ts):
 *  1. A confirmed booking is NEVER cancelled because someone else offers more. It only changes through
 *     (a) a specific offer shown to the customer, (b) the customer's separate, explicit acceptance of it.
 *  2. The customer must have opted in at checkout (stored consent), the listing + partner must allow buyback,
 *     and an administrator must have switched the feature on after recording a legal-review reference.
 *  3. Rejecting or ignoring an offer has no effect on the booking.
 *  4. Inventory is released only after the refund has succeeded and the compensation has been paid/scheduled.
 */

export interface BuybackQuote {
  originalTotalCents: number; originalPriceCents: number; originalCustomerFeeCents: number; originalCommissionCents: number;
  compensationCents: number; paymentCostCents: number;
  resalePriceCents: number; resaleCustomerFeeCents: number; resaleTotalCents: number; buybackFeeCents: number;
  partnerKeepNetCents: number; partnerBuybackNetCents: number; netBenefitCents: number;
  customerAReceivesCents: number; platformRevenueCents: number;
}

export async function quoteBuyback(c: Queryable, a: { reservationId: string; compensationCents: number; resalePriceCents: number }): Promise<BuybackQuote> {
  const r = (await c.query<any>("select r.*, l.category from reservations r join listings l on l.id = r.listing_id where r.id = $1", [a.reservationId])).rows[0];
  if (!r) throw new DomainError("NOT_FOUND", "Booking not found");
  const commissionA = Number((await c.query<any>("select coalesce(sum(amount_cents),0) s from platform_fees where reservation_id = $1 and kind in ('commission','buyback_fee','resale_fee')", [r.id])).rows[0].s);
  const proc = await getSetting<{ bps: number; fixed_cents: number }>(c, "payments.processing", { bps: 175, fixed_cents: 30 });
  const paymentCost = Math.round((r.total_cents * proc.bps) / 10_000) + proc.fixed_cents;
  const feeB = await quoteFee(c, { payer: "customer", flow: customerFeeFlow("buyback"), category: r.category, partnerId: r.partner_id, basisCents: a.resalePriceCents });
  const cut = await quoteFee(c, { payer: "partner", flow: partnerFeeFlow("buyback", r.category), category: r.category, partnerId: r.partner_id, basisCents: a.resalePriceCents });
  const keep = r.price_cents - commissionA;
  const after = a.resalePriceCents - cut.amount - a.compensationCents - paymentCost;
  return {
    originalTotalCents: r.total_cents, originalPriceCents: r.price_cents, originalCustomerFeeCents: r.customer_fee_cents, originalCommissionCents: commissionA,
    compensationCents: a.compensationCents, paymentCostCents: paymentCost,
    resalePriceCents: a.resalePriceCents, resaleCustomerFeeCents: feeB.amount, resaleTotalCents: a.resalePriceCents + feeB.amount, buybackFeeCents: cut.amount,
    partnerKeepNetCents: keep, partnerBuybackNetCents: after, netBenefitCents: after - keep,
    customerAReceivesCents: r.total_cents + a.compensationCents,
    platformRevenueCents: feeB.amount + cut.amount + paymentCost - r.customer_fee_cents - commissionA,
  };
}

export interface Eligibility { eligible: boolean; reasons: string[] }

export async function checkEligibility(c: Queryable, reservationId: string, now = new Date()): Promise<Eligibility> {
  const reasons: string[] = [];
  const r = (await c.query<any>(
    `select r.*, l.starts_at, l.category, l.buyback_eligible, p.buyback_enabled, p.buyback_min_notice_hours, p.status as partner_status, u.status as unit_status
       from reservations r join listings l on l.id = r.listing_id join partners p on p.id = r.partner_id join inventory_units u on u.id = r.unit_id where r.id = $1`, [reservationId])).rows[0];
  if (!r) return { eligible: false, reasons: ["Booking not found"] };
  if (!(await featureOn(c, "features.buyback"))) reasons.push("Customer buyback is switched off platform-wide (legal review not yet recorded).");
  if (r.category === "event" && !(await featureOn(c, "features.event_resale"))) reasons.push("Event ticket resale is switched off platform-wide (legal review not yet recorded).");
  if (r.partner_status !== "approved") reasons.push("Partner is not approved.");
  if (!r.buyback_enabled) reasons.push("You have not enabled buyback for your business.");
  if (!r.buyback_eligible) reasons.push("This listing was not published as buyback-eligible.");
  if (r.status !== "confirmed" || r.unit_status !== "booked") reasons.push("The booking is not in a confirmed state (or an offer is already in progress).");
  const consent = (await c.query("select 1 from buyback_consents where reservation_id = $1 and kind = 'checkout_opt_in'", [r.id])).rows[0];
  if (!r.buyback_consent || !consent) reasons.push("The customer did not opt in to buyback offers when booking.");
  if ((new Date(r.starts_at).getTime() - now.getTime()) / 3_600_000 < r.buyback_min_notice_hours) reasons.push(`Too close to the start (minimum notice is ${r.buyback_min_notice_hours}h).`);
  const limits = await getSetting<{ max_offers_per_reservation: number }>(c, "buyback.limits", { max_offers_per_reservation: 2 });
  const n = Number((await c.query<any>("select count(*)::int n from buyback_offers where reservation_id = $1 and status <> 'cancelled'", [r.id])).rows[0].n);
  if (n >= limits.max_offers_per_reservation) reasons.push("The maximum number of offers to this customer has been reached.");
  return { eligible: reasons.length === 0, reasons };
}

/** Customer B is chosen by the partner's published waitlist policy — never hand-picked. */
export async function pickWaitlistCandidate(c: Queryable, listingId: string, priceCents: number, excludeCustomerId: string) {
  const l = (await c.query<any>("select p.waitlist_policy from listings l join partners p on p.id = l.partner_id where l.id = $1", [listingId])).rows[0];
  const order = l.waitlist_policy === "highest_offer" ? "coalesce(w.max_price_cents, $2) desc, w.created_at asc" : "w.created_at asc";
  return (await c.query<any>(
    `select w.* from waitlist_entries w join users u on u.id = w.customer_id
      where w.listing_id = $1 and w.status = 'active' and u.status = 'active' and w.customer_id <> $3 and (w.max_price_cents is null or w.max_price_cents >= $2)
      order by ${order} limit 1`, [listingId, priceCents, excludeCustomerId])).rows[0] ?? null;
}

export async function proposeBuyback(a: { partnerId: string; actor: Actor; reservationId: string; compensationCents: number; resalePriceCents: number; note?: string }) {
  const out = await inTx(async (tx) => {
    const r = (await tx.query<any>(
      `select r.*, l.starts_at, l.category, l.min_price_cents, l.max_price_cents, l.original_price_cents, l.title,
              p.buyback_min_comp_bps, p.buyback_max_comp_bps, p.buyback_approval_threshold_cents, p.buyback_min_notice_hours
         from reservations r join listings l on l.id = r.listing_id join partners p on p.id = r.partner_id where r.id = $1 for update of r`, [a.reservationId])).rows[0];
    if (!r || r.partner_id !== a.partnerId) throw new DomainError("FORBIDDEN", "Not your booking");
    const el = await checkEligibility(tx, r.id);
    if (!el.eligible) throw new DomainError("NOT_ELIGIBLE", el.reasons[0], el.reasons);

    const minComp = Math.round((r.price_cents * r.buyback_min_comp_bps) / 10_000), maxComp = Math.round((r.price_cents * r.buyback_max_comp_bps) / 10_000);
    if (a.compensationCents < minComp || a.compensationCents > maxComp) throw new DomainError("INVALID", `Compensation must be between ${aud(minComp)} and ${aud(maxComp)} (your buyback rules)`);
    if (a.resalePriceCents < r.min_price_cents || a.resalePriceCents > r.max_price_cents) throw new DomainError("INVALID", `Resale price must be between ${aud(r.min_price_cents)} and ${aud(r.max_price_cents)}`);
    if (r.category === "event") {
      const cap = (await getSetting<{ cap_bps: number }>(tx, "features.event_resale", { cap_bps: 11000 })).cap_bps;
      if (a.resalePriceCents > Math.round((r.original_price_cents * cap) / 10_000)) throw new DomainError("NOT_ELIGIBLE", `Ticket resale is capped at ${(cap / 100).toFixed(0)}% of face value (${aud(Math.round((r.original_price_cents * cap) / 10_000))})`);
    }
    const cand = await pickWaitlistCandidate(tx, r.listing_id, a.resalePriceCents, r.customer_id);
    if (!cand) throw new DomainError("NOT_ELIGIBLE", "No waitlisted customer has a maximum price that covers this resale price.");

    const q = await quoteBuyback(tx, { reservationId: r.id, compensationCents: a.compensationCents, resalePriceCents: a.resalePriceCents });
    if (q.netBenefitCents <= 0) throw new DomainError("NOT_ELIGIBLE", `This buyback would not benefit you (net ${aud(q.netBenefitCents)}). Adjust the compensation or resale price.`);

    const needsAdmin = a.compensationCents > r.buyback_approval_threshold_cents || r.category === "event";
    const lim = await getSetting<{ customer_response_hours: number }>(tx, "buyback.limits", { customer_response_hours: 24 });
    const latest = new Date(new Date(r.starts_at).getTime() - r.buyback_min_notice_hours * 3_600_000);
    const expires = new Date(Math.min(Date.now() + lim.customer_response_hours * 3_600_000, latest.getTime()));
    const status = needsAdmin ? "pending_admin" : "pending_customer";

    const offer = (await tx.query<any>(
      `insert into buyback_offers(reservation_id, listing_id, partner_id, customer_id, waitlist_entry_id, initiated_by, status, original_amount_cents,
         compensation_cents, payment_cost_cents, resale_price_cents, resale_customer_fee_cents, platform_fee_cents, partner_net_cents, partner_keep_net_cents,
         net_benefit_cents, calc, requires_admin_approval, note_to_customer, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20) returning id`,
      [r.id, r.listing_id, r.partner_id, r.customer_id, cand.id, a.actor.id, status, r.total_cents, a.compensationCents, q.paymentCostCents, a.resalePriceCents,
       q.resaleCustomerFeeCents, q.buybackFeeCents, q.partnerBuybackNetCents, q.partnerKeepNetCents, q.netBenefitCents, JSON.stringify(q), needsAdmin, a.note ?? null, expires])).rows[0];

    await transition(tx, r.unit_id, "buyback_requested", { actor: a.actor.id, reason: "buyback proposed", refType: "buyback_offer", refId: offer.id });
    if (!needsAdmin) {
      await transition(tx, r.unit_id, "buyback_pending", { actor: a.actor.id, reason: "offer sent to customer", refType: "buyback_offer", refId: offer.id });
      await notifyCustomerOfOffer(tx, offer.id);
    }
    await audit(tx, a.actor, "buyback.proposed", "buyback_offer", offer.id, { reservationId: r.id, compensation: a.compensationCents, resale: a.resalePriceCents, needsAdmin, netBenefit: q.netBenefitCents });
    return { offerId: offer.id as string, status };
  });
  void flushNotifications().catch(() => {});
  return out;
}

async function notifyCustomerOfOffer(tx: Tx, offerId: string) {
  const o = (await tx.query<any>("select b.*, l.title, l.starts_at, r.reference from buyback_offers b join listings l on l.id = b.listing_id join reservations r on r.id = b.reservation_id where b.id = $1", [offerId])).rows[0];
  await notify(tx, o.customer_id, {
    kind: "buyback_offer", title: "Optional offer for your booking",
    body: `${o.title} wants to offer you ${aud(o.original_amount_cents)} back (a full refund) plus ${aud(o.compensation_cents)} compensation if you'd like to release booking ${o.reference}. Totally optional — your booking stays as it is unless you accept. Respond by ${fmtDateTime(o.expires_at)}.`,
    link: "/account/offers",
  });
}

/** Administrator decision on exceptional (over-threshold / regulated) proposals. */
export async function decideBuybackApproval(a: { offerId: string; approve: boolean; actor: Actor; note?: string }) {
  await inTx(async (tx) => {
    const o = (await tx.query<any>("select * from buyback_offers where id = $1 for update", [a.offerId])).rows[0];
    if (!o || o.status !== "pending_admin") throw new DomainError("CONFLICT", "This proposal is not awaiting approval");
    const res = (await tx.query<any>("select unit_id from reservations where id = $1", [o.reservation_id])).rows[0];
    if (!a.approve) {
      await tx.query("update buyback_offers set status = 'cancelled', updated_at = now() where id = $1", [o.id]);
      await transition(tx, res.unit_id, "booked", { actor: a.actor.id, reason: "buyback not approved" });
      await notifyPartnerOwner(tx, o.partner_id, { kind: "buyback_declined", title: "Buyback proposal not approved", body: a.note ?? "An administrator did not approve this proposal.", link: "/partner/buybacks" });
    } else {
      const el = await checkEligibility(tx, o.reservation_id).catch(() => null);
      // eligibility ignores the already-requested unit state, so re-check only the policy reasons that matter
      const blocking = (el?.reasons ?? []).filter((x) => !x.includes("not in a confirmed state") && !x.includes("maximum number of offers"));
      if (blocking.length) throw new DomainError("NOT_ELIGIBLE", blocking[0], blocking);
      await tx.query("update buyback_offers set status = 'pending_customer', admin_approved_by = $2, admin_approved_at = now(), updated_at = now() where id = $1", [o.id, a.actor.id]);
      await transition(tx, res.unit_id, "buyback_pending", { actor: a.actor.id, reason: "admin approved — offer sent", refType: "buyback_offer", refId: o.id });
      await notifyCustomerOfOffer(tx, o.id);
    }
    await audit(tx, a.actor, a.approve ? "buyback.approved" : "buyback.declined", "buyback_offer", o.id, { note: a.note ?? null });
  });
  void flushNotifications().catch(() => {});
}

export async function respondToBuyback(a: { customerId: string; offerId: string; decision: "accept" | "reject"; ip?: string | null }) {
  const r = await inTx(async (tx) => {
    const o = (await tx.query<any>("select * from buyback_offers where id = $1 for update", [a.offerId])).rows[0];
    if (!o || o.customer_id !== a.customerId) throw new DomainError("NOT_FOUND", "Offer not found");
    if (o.status === "processing" && a.decision === "accept") return { offerId: o.id, refundId: (await tx.query<any>("select id from refunds where idempotency_key = $1", [`buyback:${o.id}`])).rows[0]?.id as string | undefined };
    if (o.status !== "pending_customer") throw new DomainError("EXPIRED", "This offer is no longer open");
    if (new Date(o.expires_at) <= new Date()) throw new DomainError("EXPIRED", "This offer has expired. Your booking is unchanged.");
    const res = (await tx.query<any>("select * from reservations where id = $1 for update", [o.reservation_id])).rows[0];
    const terms = (await getSetting<{ version: string }>(tx, "legal.terms_version", { version: "unversioned" })).version;

    if (a.decision === "reject") {
      await tx.query("update buyback_offers set status = 'rejected', responded_at = now(), updated_at = now() where id = $1", [o.id]);
      await transition(tx, res.unit_id, "booked", { actor: a.customerId, reason: "customer declined buyback offer", refType: "buyback_offer", refId: o.id });
      await tx.query("insert into buyback_consents(reservation_id, customer_id, kind, buyback_offer_id, terms_version, terms_snapshot, ip) values ($1,$2,'offer_rejection',$3,$4,$5,$6)",
        [res.id, a.customerId, o.id, terms, "Customer declined the offer; booking unchanged.", a.ip ?? null]);
      await notifyPartnerOwner(tx, o.partner_id, { kind: "buyback_rejected", title: "Buyback offer declined", body: `The customer for ${res.reference} kept their booking.`, link: "/partner/buybacks" });
      await audit(tx, { id: a.customerId, role: "customer", ip: a.ip }, "buyback.rejected", "buyback_offer", o.id);
      return { offerId: o.id, refundId: undefined };
    }

    // ── accept ──
    if (res.status !== "confirmed") throw new DomainError("CONFLICT", "This booking is no longer active");
    const entry = (await tx.query<any>("select * from waitlist_entries where id = $1 for update", [o.waitlist_entry_id])).rows[0];
    if (!entry || entry.status !== "active" || !(await featureOn(tx, "features.buyback"))) {
      await tx.query("update buyback_offers set status = 'cancelled', updated_at = now() where id = $1", [o.id]);
      await transition(tx, res.unit_id, "booked", { actor: a.customerId, reason: "buyback no longer possible" });
      await notify(tx, a.customerId, { kind: "buyback_void", title: "Offer no longer available", body: "The offer fell through before you accepted. Your booking is unchanged — nothing has been cancelled.", link: "/account/offers" });
      throw new DomainError("EXPIRED", "This offer is no longer possible. Your booking is unchanged.");
    }
    const l = (await tx.query<any>("select title, starts_at from listings where id = $1", [o.listing_id])).rows[0];
    await tx.query("insert into buyback_consents(reservation_id, customer_id, kind, buyback_offer_id, terms_version, terms_snapshot, ip) values ($1,$2,'offer_acceptance',$3,$4,$5,$6)",
      [res.id, a.customerId, o.id, terms, buybackOfferText(terms, { refundCents: res.total_cents, compensationCents: o.compensation_cents, expiresAt: fmtDateTime(o.expires_at) }), a.ip ?? null]);
    await tx.query("update buyback_offers set status = 'processing', responded_at = now(), updated_at = now() where id = $1", [o.id]);
    const pay = (await tx.query<any>("select * from payments where order_id = $1 for update", [res.order_id])).rows[0];
    const refundId = (await tx.query<any>(
      `insert into refunds(payment_id, reservation_id, amount_cents, kind, reason, idempotency_key, requested_by)
       values ($1,$2,$3,'buyback','Customer accepted buyback offer',$4,$5) returning id`, [pay.id, res.id, res.total_cents, `buyback:${o.id}`, a.customerId])).rows[0].id;
    await audit(tx, { id: a.customerId, role: "customer", ip: a.ip }, "buyback.accepted", "buyback_offer", o.id, { refundId, listing: l.title });
    return { offerId: o.id, refundId: refundId as string };
  });
  if (a.decision === "accept") await finishBuyback(r.offerId);
  void flushNotifications().catch(() => {});
}

/**
 * Drives an accepted offer forward: refund → (cancel + ledger) → compensation → release → offer to customer B.
 * Every step is idempotent so the reconciler can call this repeatedly until it completes.
 */
export async function finishBuyback(offerId: string): Promise<"done" | "waiting"> {
  const db = await getDb();
  const o = (await db.query<any>("select * from buyback_offers where id = $1", [offerId])).rows[0];
  if (!o || o.status !== "processing") return "done";
  const refund = (await db.query<any>("select * from refunds where idempotency_key = $1", [`buyback:${offerId}`])).rows[0];
  if (!refund) return "waiting";
  if (refund.status !== "succeeded") {
    const s = await settleRefund(refund.id);
    if (!s.ok) return "waiting";
  }
  const comp = (await db.query<any>("select * from compensation_payments where buyback_offer_id = $1", [offerId])).rows[0];
  if (comp && !comp.provider_ref) {
    try {
      const pay = (await db.query<any>("select p.provider from payments p join reservations r on r.order_id = p.order_id where r.id = $1", [o.reservation_id])).rows[0];
      const res = await providerByName(pay.provider).payCompensation({ customerId: comp.customer_id, amountCents: comp.amount_cents, idempotencyKey: comp.idempotency_key });
      await db.query("update compensation_payments set provider_ref = $2, status = $3, paid_at = case when $3 = 'paid' then now() else null end where id = $1", [comp.id, res.ref, res.paid ? "paid" : "pending"]);
    } catch (e) {
      await db.query("insert into integration_events(integration, level, message) values ('payments','error',$1)", [`compensation for buyback ${offerId} failed: ${e}`]);
      return "waiting";
    }
  }
  await inTx(async (tx) => {
    const cur = (await tx.query<any>("select * from buyback_offers where id = $1 for update", [offerId])).rows[0];
    if (cur.status !== "processing") return;
    const res = (await tx.query<any>("select unit_id from reservations where id = $1", [cur.reservation_id])).rows[0];
    await tx.query("update buyback_offers set status = 'resale_pending', updated_at = now() where id = $1", [offerId]);
    await notify(tx, cur.customer_id, {
      kind: "buyback_done", title: "Your refund and compensation are on the way",
      body: `Booking cancelled as agreed. Refund ${aud(cur.original_amount_cents)} + compensation ${aud(cur.compensation_cents)}. Thank you for helping out.`, link: "/account/payments",
    });
    const offer = await reofferUnit(tx, res.unit_id, { source: "buyback", price: cur.resale_price_cents, buybackOfferId: offerId, preferEntryId: cur.waitlist_entry_id, actor: SYSTEM.id });
    if (!offer) await onResaleFailed(tx, offerId);
  });
  return "done";
}

/** Runs inside the refund-success transaction: cancels A's reservation and records every cost the partner bears. */
export async function afterBuybackRefund(tx: Tx, refund: any) {
  const offerId = String(refund.idempotency_key).replace(/^buyback:/, "");
  const o = (await tx.query<any>("select * from buyback_offers where id = $1 for update", [offerId])).rows[0];
  if (!o) return;
  const res = (await tx.query<any>("select * from reservations where id = $1 for update", [refund.reservation_id])).rows[0];
  await tx.query("update reservations set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Released via buyback offer (customer accepted)', cancelled_by = $2 where id = $1", [res.id, res.customer_id]);
  await transition(tx, res.unit_id, "cancelled", { actor: res.customer_id, reason: "buyback accepted and refunded", refType: "buyback_offer", refId: o.id });
  if (o.compensation_cents > 0) {
    await tx.query("insert into ledger_entries(partner_id, reservation_id, buyback_offer_id, kind, amount_cents, note) values ($1,$2,$3,'compensation',$4,$5)", [o.partner_id, res.id, o.id, -o.compensation_cents, `Buyback compensation ${res.reference}`]);
    await tx.query("insert into compensation_payments(buyback_offer_id, customer_id, amount_cents, idempotency_key) values ($1,$2,$3,$4) on conflict (idempotency_key) do nothing", [o.id, res.customer_id, o.compensation_cents, `comp:${o.id}`]);
  }
  if (o.payment_cost_cents > 0) {
    await tx.query("insert into ledger_entries(partner_id, reservation_id, buyback_offer_id, kind, amount_cents, note) values ($1,$2,$3,'payment_cost',$4,$5)", [o.partner_id, res.id, o.id, -o.payment_cost_cents, `Non-refundable payment processing on ${res.reference}`]);
    await tx.query("insert into platform_fees(kind, reservation_id, buyback_offer_id, partner_id, basis_cents, amount_cents, gst_cents) values ('payment_cost_recovery',$1,$2,$3,$4,$5,0)", [res.id, o.id, o.partner_id, res.total_cents, o.payment_cost_cents]);
  }
}

export async function onResaleConfirmed(tx: Tx, orderId: string) {
  const o = (await tx.query<any>(
    "select b.* from buyback_offers b join waitlist_offers w on w.buyback_offer_id = b.id join orders x on x.waitlist_offer_id = w.id where x.id = $1 for update of b", [orderId])).rows[0];
  if (!o) return;
  await tx.query("update buyback_offers set status = 'completed', updated_at = now() where id = $1", [o.id]);
  await notifyPartnerOwner(tx, o.partner_id, { kind: "buyback_complete", title: "Buyback completed", body: `The room was resold for ${aud(o.resale_price_cents)}. Estimated net benefit ${aud(o.net_benefit_cents)}.`, link: "/partner/buybacks" });
  await audit(tx, SYSTEM, "buyback.completed", "buyback_offer", o.id, { resaleCents: o.resale_price_cents });
}

export async function onResaleFailed(tx: Tx, offerId: string) {
  const o = (await tx.query<any>("select * from buyback_offers where id = $1 for update", [offerId])).rows[0];
  if (!o || ["completed", "completed_unsold"].includes(o.status)) return;
  await tx.query("update buyback_offers set status = 'completed_unsold', updated_at = now() where id = $1", [offerId]);
  await notifyPartnerOwner(tx, o.partner_id, { kind: "buyback_unsold", title: "Resale didn't complete", body: "The customer was refunded and compensated as agreed, but the waitlisted customer didn't complete the purchase. The room is back on sale. Compensation already paid is not recoverable.", link: "/partner/buybacks" });
  await audit(tx, SYSTEM, "buyback.resale_failed", "buyback_offer", offerId);
}

/** Expires unanswered offers; the booking simply returns to normal. */
export async function expireBuybacks(tx: Tx, now = new Date()): Promise<number> {
  const rows = (await tx.query<any>("select o.*, r.unit_id from buyback_offers o join reservations r on r.id = o.reservation_id where o.status in ('pending_admin','pending_customer') and o.expires_at <= $1 for update of o", [now])).rows;
  for (const o of rows) {
    await tx.query("update buyback_offers set status = 'expired', updated_at = now() where id = $1", [o.id]);
    await transition(tx, o.unit_id, "booked", { reason: "buyback offer expired — booking unchanged", refType: "buyback_offer", refId: o.id });
    await notifyPartnerOwner(tx, o.partner_id, { kind: "buyback_expired", title: "Buyback offer expired", body: "The customer didn't respond in time. Their booking is unchanged.", link: "/partner/buybacks" });
  }
  return rows.length;
}

// ─────────────── Opportunity finder for partner dashboards ───────────────
export async function findOpportunities(partnerId: string) {
  const db = await getDb();
  const rows = (await db.query<any>(
    `select r.id as reservation_id, r.reference, r.price_cents, r.customer_id, l.id as listing_id, l.title, l.starts_at, l.max_price_cents, l.min_price_cents, l.category, l.original_price_cents,
            p.buyback_min_comp_bps, p.waitlist_policy
       from reservations r join listings l on l.id = r.listing_id join partners p on p.id = r.partner_id
      where r.partner_id = $1 and r.status = 'confirmed' and l.starts_at > now() and r.buyback_consent
        and exists (select 1 from waitlist_entries w where w.listing_id = l.id and w.status = 'active')
      order by l.starts_at limit 30`, [partnerId])).rows;
  const out: any[] = [];
  for (const r of rows) {
    const el = await checkEligibility(db, r.reservation_id);
    if (!el.eligible) continue;
    const entries = (await db.query<any>("select * from waitlist_entries where listing_id = $1 and status = 'active' and customer_id <> $2 and max_price_cents is not null order by max_price_cents desc", [r.listing_id, r.customer_id])).rows;
    const comp = Math.ceil((r.price_cents * r.buyback_min_comp_bps) / 10_000 / 100) * 100;
    let capEvent = Infinity;
    if (r.category === "event") capEvent = Math.round((r.original_price_cents * (await getSetting<{ cap_bps: number }>(db, "features.event_resale", { cap_bps: 11000 })).cap_bps) / 10_000);
    for (const e of entries) {
      const price = Math.min(e.max_price_cents, r.max_price_cents, capEvent);
      if (price < r.min_price_cents) continue;
      const cand = await pickWaitlistCandidate(db, r.listing_id, price, r.customer_id);
      if (!cand) continue;
      const quote = await quoteBuyback(db, { reservationId: r.reservation_id, compensationCents: comp, resalePriceCents: price });
      if (quote.netBenefitCents > 0) { out.push({ ...r, suggestedCompensation: comp, suggestedPrice: price, candidateMax: cand.max_price_cents, quote }); break; }
    }
  }
  return out.sort((a, b) => b.quote.netBenefitCents - a.quote.netBenefitCents);
}
