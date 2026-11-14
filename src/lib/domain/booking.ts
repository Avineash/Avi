import { getDb, inTx, type Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { aud, fmtDateTime } from "@/lib/util";
import { holdUnits, transition } from "./inventory";
import { createOrder, partnerFeeFlow } from "./orders";
import { startPayment } from "./payments";
import { quoteFee, gstOf } from "./fees";
import { refundBps, hoursUntil, type CancellationPolicy } from "./policies";
import { notify, notifyPartnerOwner, flushNotifications } from "./notifications";
import { reofferUnit } from "./waitlist";
import { audit, SYSTEM, type Actor } from "./audit";
import { providerByName, SANDBOX_CARDS } from "@/lib/providers/payments";

const isUnique = (e: any) => e?.code === "23505";

// ─────────────────────────── Checkout ───────────────────────────
export interface CheckoutInput {
  customerId: string; listingId: string; quantity: number; guests: number;
  guestName: string; guestEmail: string; guestPhone?: string | null; specialRequests?: string | null;
  buybackConsent: boolean; idempotencyKey: string; ip?: string | null;
}

/** Hold inventory atomically, lock the price and create the order + pending payment. Idempotent per key. */
export async function createCheckout(i: CheckoutInput): Promise<{ orderId: string; existing: boolean }> {
  const run = () => inTx(async (tx) => {
    const ex = (await tx.query<any>("select id, customer_id from orders where idempotency_key = $1", [i.idempotencyKey])).rows[0];
    if (ex) {
      if (ex.customer_id !== i.customerId) throw new DomainError("FORBIDDEN", "Not your order");
      return { orderId: ex.id as string, existing: true };
    }
    const held = await holdUnits(tx, { listingId: i.listingId, quantity: i.quantity, userId: i.customerId });
    const o = await createOrder(tx, { ...i, unitIds: held.unitIds, source: "direct", reservedUntil: held.reservedUntil });
    await audit(tx, { id: i.customerId, role: "customer", ip: i.ip }, "order.created", "order", o.orderId, { listingId: i.listingId, quantity: i.quantity, totalCents: o.totalCents });
    return { orderId: o.orderId, existing: false };
  });
  let res;
  try { res = await run(); }
  catch (e) {
    if (isUnique(e) && String((e as any).message ?? "").includes("idempotency_key")) res = await run(); // concurrent duplicate submit → return the winner's order
    else throw e;
  }
  await startPayment(res.orderId); // no-op if already started
  return res;
}

export async function getOrderView(orderId: string) {
  const db = await getDb();
  const o = (await db.query<any>(
    `select o.*, p.id as payment_id, p.provider, p.status as payment_status, p.client_secret, p.failure_reason, p.amount_cents as payment_amount
       from orders o join payments p on p.order_id = o.id where o.id = $1`, [orderId])).rows[0];
  if (!o) return null;
  const items = (await db.query<any>(
    `select r.*, l.title, l.starts_at, l.ends_at, l.category, l.cancellation_policy as listing_policy, v.name as venue_name, v.suburb, u.label
       from reservations r join listings l on l.id = r.listing_id join venues v on v.id = l.venue_id join inventory_units u on u.id = r.unit_id
      where r.order_id = $1 order by u.label`, [orderId])).rows;
  return { ...o, items };
}

// ─────────────────────────── Payment lifecycle ───────────────────────────
/** Sandbox checkout: validates a Stripe-style test card and drives the same authorise → capture path as production. */
export async function sandboxPay(a: { orderId: string; customerId: string; cardNumber: string }) {
  const db = await getDb();
  const p = (await db.query<any>(`select p.*, o.customer_id, o.status as order_status from payments p join orders o on o.id = p.order_id where p.order_id = $1`, [a.orderId])).rows[0];
  if (!p || p.customer_id !== a.customerId) throw new DomainError("NOT_FOUND", "Order not found");
  if (p.provider !== "sandbox") throw new DomainError("INVALID", "This order is paid through Stripe");
  if (p.order_status !== "pending_payment") throw new DomainError("EXPIRED", p.order_status === "paid" ? "This order is already paid" : "This order has expired — please start again");
  const card = SANDBOX_CARDS[a.cardNumber.replace(/\s|-/g, "")];
  if (!card) throw new DomainError("INVALID", "Sandbox accepts Stripe test cards only, e.g. 4242 4242 4242 4242");
  if (!card.ok) {
    await db.query("update payments set failure_reason = $2 where id = $1 and status = 'requires_payment'", [p.id, card.message]);
    throw new DomainError("PAYMENT_FAILED", card.message ?? "Payment declined");
  }
  const withRef = p.provider_ref ? p : await startPayment(a.orderId);
  return onPaymentAuthorized("sandbox", withRef.provider_ref);
}

/**
 * Called when funds are authorised (Stripe webhook / sandbox form). Safe to call any number of times:
 *   1. lock payment; verify the customer still holds every unit → otherwise void the authorisation
 *   2. capture (external, idempotent key)
 *   3. confirm: units booked, reservations confirmed, fees + ledger recorded
 */
export async function onPaymentAuthorized(provider: "sandbox" | "stripe", providerRef: string): Promise<"confirmed" | "voided" | "failed" | "unknown"> {
  const p1 = await inTx(async (tx) => {
    const p = (await tx.query<any>("select * from payments where provider = $1 and provider_ref = $2 for update", [provider, providerRef])).rows[0];
    if (!p) return { kind: "unknown" as const };
    if (["captured", "partially_refunded", "refunded"].includes(p.status)) return { kind: "done" as const };
    const order = (await tx.query<any>("select * from orders where id = $1 for update", [p.order_id])).rows[0];
    let ok: boolean;
    if (order.source === "resale") {
      const { resaleCapturable } = await import("./resale"); // peer-resale orders have no inventory units: stock was decremented at checkout
      ok = p.status !== "cancelled" && (await resaleCapturable(tx, order.id));
    } else {
      const res = (await tx.query<any>(
        "select r.status, u.status as unit_status, u.held_by from reservations r join inventory_units u on u.id = r.unit_id where r.order_id = $1", [p.order_id])).rows;
      ok = p.status !== "cancelled" && order.status === "pending_payment" && res.length > 0 &&
        res.every((r) => r.status === "pending_payment" && r.unit_status === "held" && r.held_by === order.customer_id);
    }
    if (p.status === "requires_payment" || p.status === "cancelled") {
      await tx.query("update payments set status = $2, authorized_at = coalesce(authorized_at, now()) where id = $1", [p.id, ok ? "authorized" : "cancelled"]);
    }
    return { kind: ok ? ("capture" as const) : ("void" as const), p };
  });
  if (p1.kind === "unknown") return "unknown";
  if (p1.kind === "done") return "confirmed";
  const p = p1.p!;
  const prov = providerByName(provider);

  if (p1.kind === "void") {
    await prov.cancel(providerRef, `void:${p.id}`).catch(async (e) => logIntegration(provider, "error", `void failed for ${p.id}: ${e}`));
    return "voided";
  }
  try {
    await prov.capture(providerRef, p.amount_cents, `cap:${p.id}`);
  } catch (e) {
    await logIntegration(provider, "error", `capture failed for payment ${p.id}: ${e}`);
    await inTx(async (tx) => {
      await tx.query("update payments set status = 'failed', failure_reason = $2 where id = $1 and status = 'authorized'", [p.id, "capture failed"]);
    });
    await prov.cancel(providerRef, `void:${p.id}`).catch(() => {});
    await expireOrder(p.order_id, "capture failed", true);
    return "failed";
  }
  await inTx((tx) => confirmOrder(tx, p.id));
  void flushNotifications().catch(() => {});
  return "confirmed";
}

export async function onPaymentFailed(provider: "sandbox" | "stripe", providerRef: string, reason: string) {
  const db = await getDb();
  await db.query("update payments set failure_reason = $3 where provider = $1 and provider_ref = $2 and status = 'requires_payment'", [provider, providerRef, reason]);
}

async function logIntegration(integration: string, level: "info" | "warn" | "error", message: string) {
  const db = await getDb();
  await db.query("insert into integration_events(integration, level, message) values ($1,$2,$3)", [integration, level, message]);
}

async function confirmOrder(tx: Tx, paymentId: string) {
  const p = (await tx.query<any>("select * from payments where id = $1 for update", [paymentId])).rows[0];
  if (!p || p.status !== "authorized") return; // already confirmed (idempotent) or voided
  const order = (await tx.query<any>("select * from orders where id = $1 for update", [p.order_id])).rows[0];
  if (order.source === "resale") {
    const { confirmResaleOrder } = await import("./resale");
    await confirmResaleOrder(tx, p, order);
    return;
  }
  const rows = (await tx.query<any>(
    `select r.*, l.category, l.title, l.starts_at from reservations r join listings l on l.id = r.listing_id where r.order_id = $1 order by r.created_at, r.id`, [order.id])).rows;
  const flow = partnerFeeFlow(order.source, rows[0].category);
  const kind = flow === "booking" ? "commission" : flow === "buyback" ? "buyback_fee" : "resale_fee";

  for (const r of rows) {
    await transition(tx, r.unit_id, "booked", { actor: order.customer_id, reason: "payment captured", expectFrom: ["held"], refType: "reservation", refId: r.id });
    await tx.query("update reservations set status = 'confirmed' where id = $1", [r.id]);
    const fee = await quoteFee(tx, { payer: "partner", flow, category: r.category, partnerId: r.partner_id, basisCents: r.price_cents });
    await tx.query(
      `insert into platform_fees(kind, order_id, reservation_id, partner_id, basis_cents, rate_bps, fixed_cents, amount_cents, gst_cents, rule_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [kind, order.id, r.id, r.partner_id, r.price_cents, fee.rule.rate_bps, fee.rule.fixed_cents, fee.amount, fee.gst, fee.rule.id]);
    await tx.query(
      `insert into platform_fees(kind, order_id, reservation_id, partner_id, basis_cents, amount_cents, gst_cents)
       values ('customer_fee',$1,$2,$3,$4,$5,$6)`, [order.id, r.id, r.partner_id, r.price_cents, r.customer_fee_cents, gstOf(r.customer_fee_cents)]);
    await tx.query("insert into ledger_entries(partner_id, reservation_id, kind, amount_cents, note) values ($1,$2,'sale',$3,$4)", [r.partner_id, r.id, r.price_cents, `Sale ${r.reference}`]);
    await tx.query("insert into ledger_entries(partner_id, reservation_id, kind, amount_cents, note) values ($1,$2,'commission',$3,$4)", [r.partner_id, r.id, -fee.amount, `${kind} ${r.reference}`]);
    await notifyPartnerOwner(tx, r.partner_id, { kind: "booking", title: "New booking", body: `${r.title} — ${fmtDateTime(r.starts_at)} · ${r.reference} · ${aud(r.price_cents)}`, link: "/partner/reservations" });
  }
  await tx.query("update orders set status = 'paid', paid_at = now() where id = $1", [order.id]);
  await tx.query("update payments set status = 'captured', captured_cents = amount_cents, captured_at = now() where id = $1", [paymentId]);
  if (order.waitlist_offer_id) {
    await tx.query("update waitlist_entries set status = 'fulfilled', updated_at = now() where id = (select entry_id from waitlist_offers where id = $1)", [order.waitlist_offer_id]);
  }
  await notify(tx, order.customer_id, {
    kind: "booking_confirmed", title: "Booking confirmed",
    body: `${rows[0].title} — ${fmtDateTime(rows[0].starts_at)}. Reference ${rows.map((r) => r.reference).join(", ")}. Total paid ${aud(order.total_cents)}.`,
    link: `/account/bookings/${rows[0].id}`,
  });
  await audit(tx, { id: order.customer_id, role: "customer" }, "order.paid", "order", order.id, { totalCents: order.total_cents, provider: p.provider });
  if (order.source === "buyback") {
    const { onResaleConfirmed } = await import("./buyback");
    await onResaleConfirmed(tx, order.id);
  }
}

/** Release everything held by an unpaid order. Idempotent. `force` ignores an in-flight authorisation. */
export async function expireOrder(orderId: string, reason: string, force = false) {
  let providerRef: string | null = null, providerName = "sandbox", paymentId: string | null = null;
  await inTx(async (tx) => {
    const order = (await tx.query<any>("select * from orders where id = $1 for update", [orderId])).rows[0];
    if (!order || order.status !== "pending_payment") return;
    const p = (await tx.query<any>("select * from payments where order_id = $1 for update", [orderId])).rows[0];
    if (!force && p?.status === "authorized" && p.authorized_at && Date.now() - new Date(p.authorized_at).getTime() < 5 * 60_000) return; // capture in flight
    await tx.query("update orders set status = $2 where id = $1", [orderId, force ? "failed" : "expired"]);
    await tx.query("update reservations set status = 'expired' where order_id = $1 and status = 'pending_payment'", [orderId]);
    if (order.source === "resale") { const { expireResaleOrder } = await import("./resale"); await expireResaleOrder(tx, order); }
    if (p && ["requires_payment", "authorized"].includes(p.status)) {
      await tx.query("update payments set status = 'cancelled', failure_reason = coalesce(failure_reason, $2) where id = $1", [p.id, reason]);
      providerRef = p.provider_ref; providerName = p.provider; paymentId = p.id;
    }
    const units = (await tx.query<any>(
      "select u.id, u.status, u.held_by from reservations r join inventory_units u on u.id = r.unit_id where r.order_id = $1 for update of u", [orderId])).rows;
    for (const u of units) {
      if (u.status !== "held" || u.held_by !== order.customer_id) continue;
      if (order.source === "direct") await transition(tx, u.id, "available", { reason: `order ${reason}`, refType: "order", refId: orderId });
      else {
        // Accepted a waitlist/buyback offer but never paid: drop them from the list and offer the unit to the next person.
        if (order.waitlist_offer_id) {
          await tx.query("update waitlist_entries set status = 'expired', updated_at = now() where id = (select entry_id from waitlist_offers where id = $1)", [order.waitlist_offer_id]);
        }
        const offer = order.waitlist_offer_id ? (await tx.query<any>("select * from waitlist_offers where id = $1", [order.waitlist_offer_id])).rows[0] : null;
        const next = await reofferUnit(tx, u.id, { source: offer?.source ?? "release", price: offer?.price_cents, buybackOfferId: offer?.buyback_offer_id });
        if (!next && offer?.source === "buyback" && offer.buyback_offer_id) {
          const { onResaleFailed } = await import("./buyback");
          await onResaleFailed(tx, offer.buyback_offer_id);
        }
      }
    }
    await audit(tx, SYSTEM, "order.expired", "order", orderId, { reason });
  });
  if (providerRef) await providerByName(providerName).cancel(providerRef, `void:${paymentId}`).catch(() => {});
}

// ─────────────────────────── Cancellation & refunds ───────────────────────────
export async function cancelReservation(a: { reservationId: string; actor: Actor; mode: "policy" | "full"; reason: string; asCustomer: boolean }) {
  const r = await inTx(async (tx) => {
    const res = (await tx.query<any>(
      "select r.*, l.starts_at, l.title from reservations r join listings l on l.id = r.listing_id where r.id = $1 for update of r", [a.reservationId])).rows[0];
    if (!res) throw new DomainError("NOT_FOUND", "Booking not found");
    if (a.asCustomer && res.customer_id !== a.actor.id) throw new DomainError("FORBIDDEN", "Not your booking");
    if (res.status !== "confirmed") throw new DomainError("CONFLICT", "Only confirmed bookings can be cancelled");
    if (new Date(res.starts_at) <= new Date()) throw new DomainError("CONFLICT", "This booking has already started and can't be cancelled online. Contact support if something went wrong.");

    // A pending buyback offer is withdrawn if the customer cancels themselves.
    const open = (await tx.query<any>("select id from buyback_offers where reservation_id = $1 and status in ('pending_admin','pending_customer') for update", [res.id])).rows[0];
    if (open) {
      await tx.query("update buyback_offers set status = 'cancelled', updated_at = now() where id = $1", [open.id]);
      await transition(tx, res.unit_id, "booked", { reason: "buyback offer withdrawn — booking cancelled by customer" });
    }
    const bps = a.mode === "full" ? 10_000 : refundBps(res.cancellation_policy as CancellationPolicy, hoursUntil(res.starts_at));
    const refundCents = Math.round((res.total_cents * bps) / 10_000);
    await tx.query("update reservations set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, cancelled_by = $3 where id = $1", [res.id, a.reason, a.actor.id]);
    await transition(tx, res.unit_id, "cancelled", { actor: a.actor.id, reason: a.reason, refType: "reservation", refId: res.id });

    let refundId: string | null = null;
    if (refundCents > 0) {
      const pay = (await tx.query<any>("select * from payments where order_id = $1 for update", [res.order_id])).rows[0];
      if (pay.captured_cents - pay.refunded_cents < refundCents) throw new DomainError("CONFLICT", "Refund exceeds the amount captured");
      refundId = (await tx.query<any>(
        `insert into refunds(payment_id, reservation_id, amount_cents, kind, reason, idempotency_key, requested_by)
         values ($1,$2,$3,'cancellation',$4,$5,$6) returning id`, [pay.id, res.id, refundCents, a.reason, `cancel:${res.id}`, a.actor.id])).rows[0].id;
    }
    await notifyPartnerOwner(tx, res.partner_id, { kind: "cancellation", title: "Booking cancelled", body: `${res.title} · ${res.reference} was cancelled. The inventory is being re-offered.`, link: "/partner/reservations" });
    await notify(tx, res.customer_id, {
      kind: "cancellation", title: "Booking cancelled",
      body: refundCents > 0 ? `${res.reference} cancelled. A refund of ${aud(refundCents)} is on its way to your original payment method.` : `${res.reference} cancelled. This booking was not eligible for a refund under its cancellation terms.`,
      link: `/account/bookings/${res.id}`,
    });
    await audit(tx, a.actor, "reservation.cancelled", "reservation", res.id, { refundCents, bps, mode: a.mode });
    return { refundId, unitId: res.unit_id as string, refundCents };
  });
  if (r.refundId) await settleRefund(r.refundId);
  else await inTx((tx) => reofferUnit(tx, r.unitId, { source: "release" }));
  void flushNotifications().catch(() => {});
  return { refundCents: r.refundCents };
}

/**
 * Executes a pending refund exactly once (provider idempotency key = refund.idempotency_key), then applies the
 * accounting (ledger / fee reversals) and any follow-up for its kind. Safe to retry; used by the maintenance reconciler.
 */
export async function settleRefund(refundId: string): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const f = (await db.query<any>("select f.*, p.provider, p.provider_ref from refunds f join payments p on p.id = f.payment_id where f.id = $1", [refundId])).rows[0];
  if (!f) throw new DomainError("NOT_FOUND", "Refund not found");
  if (f.status === "succeeded") return { ok: true };
  let providerRef: string;
  try {
    providerRef = (await providerByName(f.provider).refund(f.provider_ref, f.amount_cents, f.idempotency_key)).ref;
  } catch (e) {
    await logIntegration(f.provider, "error", `refund ${refundId} failed: ${e}`);
    return { ok: false, error: String(e) };
  }
  await inTx(async (tx) => {
    const fr = (await tx.query<any>("select * from refunds where id = $1 for update", [refundId])).rows[0];
    if (fr.status === "succeeded") return;
    await tx.query("update refunds set status = 'succeeded', provider_ref = $2, completed_at = now() where id = $1", [refundId, providerRef]);
    const pay = (await tx.query<any>("select * from payments where id = $1 for update", [fr.payment_id])).rows[0];
    const refunded = pay.refunded_cents + fr.amount_cents;
    await tx.query("update payments set refunded_cents = $2, status = $3 where id = $1", [pay.id, refunded, refunded >= pay.captured_cents ? "refunded" : "partially_refunded"]);
    if (fr.reservation_id) await applyRefundAccounting(tx, fr);
    if (fr.kind === "cancellation" && fr.reservation_id) {
      const u = (await tx.query<any>("select u.id, u.status from reservations r join inventory_units u on u.id = r.unit_id where r.id = $1", [fr.reservation_id])).rows[0];
      if (u.status === "cancelled") await reofferUnit(tx, u.id, { source: "release" });
    } else if (fr.kind === "buyback") {
      const { afterBuybackRefund } = await import("./buyback");
      await afterBuybackRefund(tx, fr);
    }
    await audit(tx, SYSTEM, "refund.succeeded", "refund", refundId, { amountCents: fr.amount_cents, kind: fr.kind });
  });
  return { ok: true };
}

/**
 * Reverses the partner ledger / platform fees for a refund. Refunds are split between the supplier price and the
 * customer service fee in proportion to what was paid; a final (full) refund always reverses everything remaining.
 */
export async function applyRefundAccounting(tx: Tx, fr: any) {
  const res = (await tx.query<any>("select * from reservations where id = $1", [fr.reservation_id])).rows[0];
  const sum = async (sql: string, extra: unknown[] = []) => Number((await tx.query<any>(sql, [res.id, ...extra])).rows[0].s);
  const priorRefundedPrice = -(await sum("select coalesce(sum(amount_cents),0) s from ledger_entries where reservation_id = $1 and kind = 'refund'"));
  const priorRefunded = await sum("select coalesce(sum(amount_cents),0) s from refunds where reservation_id = $1 and status = 'succeeded' and id <> $2", [fr.id]);
  const remainingTotal = res.total_cents - priorRefunded;
  const remainingFee = await sum("select coalesce(sum(amount_cents),0) s from platform_fees where reservation_id = $1 and kind = 'customer_fee'");
  const commissionOriginal = await sum("select coalesce(sum(amount_cents),0) s from platform_fees where reservation_id = $1 and kind in ('commission','buyback_fee','resale_fee') and not is_reversal");
  const commissionRemaining = await sum("select coalesce(sum(amount_cents),0) s from platform_fees where reservation_id = $1 and kind in ('commission','buyback_fee','resale_fee')");
  const commissionKind = (await tx.query<any>("select kind from platform_fees where reservation_id = $1 and kind in ('commission','buyback_fee','resale_fee') and not is_reversal limit 1", [res.id])).rows[0]?.kind;

  const amount = fr.amount_cents as number;
  const isFinal = amount >= remainingTotal;
  let feeRefund = isFinal ? remainingFee : Math.min(remainingFee, amount - Math.min(res.price_cents - priorRefundedPrice, Math.round((amount * res.price_cents) / res.total_cents)));
  feeRefund = Math.max(0, feeRefund);
  const priceRefund = amount - feeRefund;
  const reversal = isFinal ? commissionRemaining : Math.min(commissionRemaining, Math.round((commissionOriginal * priceRefund) / res.price_cents));

  await tx.query("insert into ledger_entries(partner_id, reservation_id, kind, amount_cents, note) values ($1,$2,'refund',$3,$4)", [res.partner_id, res.id, -priceRefund, `Refund (${fr.kind}) ${res.reference}`]);
  if (reversal > 0) {
    await tx.query("insert into ledger_entries(partner_id, reservation_id, kind, amount_cents, note) values ($1,$2,'commission_reversal',$3,$4)", [res.partner_id, res.id, reversal, `Commission reversal ${res.reference}`]);
    await tx.query(
      `insert into platform_fees(kind, order_id, reservation_id, partner_id, basis_cents, amount_cents, gst_cents, is_reversal)
       values ($1,$2,$3,$4,$5,$6,$7,true)`, [commissionKind, res.order_id, res.id, res.partner_id, -priceRefund, -reversal, -gstOf(reversal)]);
  }
  if (feeRefund > 0) {
    await tx.query(
      `insert into platform_fees(kind, order_id, reservation_id, partner_id, basis_cents, amount_cents, gst_cents, is_reversal)
       values ('customer_fee',$1,$2,$3,$4,$5,$6,true)`, [res.order_id, res.id, res.partner_id, -priceRefund, -feeRefund, -gstOf(feeRefund)]);
  }
}

/** Goodwill / partial refunds raised by a partner (own bookings) or an administrator. */
export async function issueManualRefund(a: { reservationId: string; amountCents: number; reason: string; actor: Actor; idempotencyKey: string; partnerId?: string; kind?: "partial" | "goodwill" }) {
  const refundId = await inTx(async (tx) => {
    const res = (await tx.query<any>("select * from reservations where id = $1 for update", [a.reservationId])).rows[0];
    if (!res) throw new DomainError("NOT_FOUND", "Booking not found");
    if (a.partnerId && res.partner_id !== a.partnerId) throw new DomainError("FORBIDDEN", "Not your booking");
    if (!["confirmed", "completed"].includes(res.status)) throw new DomainError("CONFLICT", "Only active or completed bookings can be refunded this way");
    const pay = (await tx.query<any>("select * from payments where order_id = $1 for update", [res.order_id])).rows[0];
    const used = Number((await tx.query<any>("select coalesce(sum(amount_cents),0) s from refunds where reservation_id = $1 and status <> 'failed'", [res.id])).rows[0].s);
    if (a.amountCents <= 0 || a.amountCents > res.total_cents - used) throw new DomainError("INVALID", `Refund must be between $0.01 and ${aud(res.total_cents - used)}`);
    if (pay.captured_cents - pay.refunded_cents < a.amountCents) throw new DomainError("CONFLICT", "Refund exceeds the amount captured");
    const ex = (await tx.query<any>("select id from refunds where idempotency_key = $1", [`manual:${a.idempotencyKey}`])).rows[0];
    if (ex) return ex.id as string;
    const id = (await tx.query<any>(
      `insert into refunds(payment_id, reservation_id, amount_cents, kind, reason, idempotency_key, requested_by, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`, [pay.id, res.id, a.amountCents, a.kind ?? "goodwill", a.reason, `manual:${a.idempotencyKey}`, a.actor.id])).rows[0].id;
    await notify(tx, res.customer_id, { kind: "refund", title: "Refund issued", body: `A refund of ${aud(a.amountCents)} for ${res.reference} is on its way.`, link: `/account/bookings/${res.id}` });
    await audit(tx, a.actor, "refund.issued", "refund", id, { amountCents: a.amountCents, reason: a.reason });
    return id;
  });
  await settleRefund(refundId);
  return refundId;
}

// ─────────────────────────── Completion ───────────────────────────
export async function completePastReservations(tx: Tx, now = new Date()): Promise<number> {
  const rows = (await tx.query<any>(
    `select r.id, r.unit_id from reservations r join listings l on l.id = r.listing_id
      where r.status = 'confirmed' and l.ends_at < $1`, [now])).rows;
  for (const r of rows) {
    const u = (await tx.query<any>("select status from inventory_units where id = $1", [r.unit_id])).rows[0];
    if (u.status === "booked") await transition(tx, r.unit_id, "completed", { reason: "stay/event completed" });
    await tx.query("update reservations set status = 'completed' where id = $1", [r.id]);
  }
  return rows.length;
}
