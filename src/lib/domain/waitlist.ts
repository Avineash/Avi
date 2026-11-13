import { getDb, inTx, type Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { aud, fmtDateTime } from "@/lib/util";
import { availability, holdMinutes, transition } from "./inventory";
import { createOrder } from "./orders";
import { startPayment } from "./payments";
import { notify } from "./notifications";
import { audit, type Actor } from "./audit";

export const WAITLIST_POLICY_TEXT: Record<string, string> = {
  first_come: "First come, first served: offers go to the earliest person on the waitlist whose maximum price covers the offer price.",
  highest_offer: "Highest offer first: offers go to the person with the highest maximum price (earliest sign-up breaks ties). You still only ever pay the offer price shown to you — never more than your maximum.",
};

export async function joinWaitlist(a: {
  customerId: string; listingId: string; maxPriceCents?: number | null;
  preferences?: Record<string, unknown>; notify?: { email: boolean; sms: boolean; push: boolean };
}) {
  return inTx(async (tx) => {
    const l = (await tx.query<any>("select * from listings where id = $1", [a.listingId])).rows[0];
    if (!l || l.status !== "published") throw new DomainError("NOT_FOUND", "Listing not found");
    if (new Date(l.booking_deadline) <= new Date()) throw new DomainError("EXPIRED", "The booking deadline has passed");
    const av = await availability(tx, a.listingId);
    if (av.available_units > 0) throw new DomainError("INVALID", "There is still availability — you can book it now.");
    if (a.maxPriceCents != null && a.maxPriceCents <= 0) throw new DomainError("INVALID", "Maximum price must be positive");
    const dup = await tx.query("select 1 from waitlist_entries where customer_id = $1 and listing_id = $2 and status in ('active','offered')", [a.customerId, a.listingId]);
    if (dup.rows[0]) throw new DomainError("CONFLICT", "You're already on the waitlist for this listing.");
    const n = a.notify ?? { email: true, sms: false, push: true };
    const e = (await tx.query<any>(
      `insert into waitlist_entries(customer_id, listing_id, max_price_cents, preferences, notify_email, notify_sms, notify_push)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7) returning id`,
      [a.customerId, a.listingId, a.maxPriceCents ?? null, JSON.stringify(a.preferences ?? {}), n.email, n.sms, n.push])).rows[0];
    await audit(tx, { id: a.customerId, role: "customer" }, "waitlist.join", "waitlist_entry", e.id, { listingId: a.listingId, max: a.maxPriceCents ?? null });
    return e.id as string;
  });
}

export async function leaveWaitlist(customerId: string, entryId: string) {
  return inTx(async (tx) => {
    const r = await tx.query("update waitlist_entries set status = 'cancelled', updated_at = now() where id = $1 and customer_id = $2 and status = 'active' returning id", [entryId, customerId]);
    if (!r.rows[0]) throw new DomainError("NOT_FOUND", "Waitlist entry not found (or an offer is already in progress)");
  });
}

export async function waitlistPosition(c: Tx | { query: Tx["query"] }, entryId: string) {
  const r = await c.query<any>(
    `select (select count(*)::int from waitlist_entries x where x.listing_id = w.listing_id and x.status = 'active' and x.created_at < w.created_at) + 1 as pos,
            (select count(*)::int from waitlist_entries x where x.listing_id = w.listing_id and x.status = 'active') as total
       from waitlist_entries w where w.id = $1`, [entryId]);
  return r.rows[0] as { pos: number; total: number } | undefined;
}

interface ReofferOpts {
  source: "release" | "buyback"; price?: number; buybackOfferId?: string | null;
  preferEntryId?: string | null; actor?: string | null;
}

/**
 * Take a unit that has just become free (cancelled / released / declined) and offer it to the next eligible
 * waitlisted customer according to the partner's published policy. If nobody is eligible the unit is relisted.
 * Returns the created offer, or null when the unit went back on sale.
 */
export async function reofferUnit(tx: Tx, unitId: string, o: ReofferOpts) {
  const unit = (await tx.query<any>("select * from inventory_units where id = $1 for update", [unitId])).rows[0];
  if (!unit) throw new DomainError("NOT_FOUND", "Unit not found");
  if (unit.status === "cancelled") await transition(tx, unitId, "released", { actor: o.actor, reason: "cancellation settled" });
  else if (unit.status === "held" || unit.status === "waitlisted" || unit.status === "available") await transition(tx, unitId, "released", { actor: o.actor, reason: "re-offer" });
  else if (unit.status !== "released") throw new DomainError("CONFLICT", `Cannot re-offer a unit that is ${unit.status}`);

  const l = (await tx.query<any>("select l.*, p.waitlist_policy, p.offer_window_minutes from listings l join partners p on p.id = l.partner_id where l.id = $1", [unit.listing_id])).rows[0];
  const now = new Date();
  const open = l.status === "published" && new Date(l.booking_deadline) > now;
  if (!open) return null; // stays 'released'; nothing can be sold any more
  const price: number = o.price ?? unit.price_override_cents ?? l.current_price_cents;
  const order = l.waitlist_policy === "highest_offer" ? "coalesce(w.max_price_cents, $2) desc, w.created_at asc" : "w.created_at asc";

  // A pre-selected entry (the buyback customer B) goes first if it is still valid and not yet offered this unit.
  let cand: any = null;
  if (o.preferEntryId) {
    cand = (await tx.query<any>(
      `select w.* from waitlist_entries w join users u on u.id = w.customer_id
        where w.id = $1 and w.status = 'active' and u.status = 'active' and (w.max_price_cents is null or w.max_price_cents >= $2)
          and not exists (select 1 from waitlist_offers x where x.entry_id = w.id and x.unit_id = $3) for update of w`, [o.preferEntryId, price, unitId])).rows[0] ?? null;
  }
  if (!cand) {
    cand = (await tx.query<any>(
      `select w.* from waitlist_entries w join users u on u.id = w.customer_id
        where w.listing_id = $1 and w.status = 'active' and u.status = 'active' and (w.max_price_cents is null or w.max_price_cents >= $2)
          and not exists (select 1 from waitlist_offers x where x.entry_id = w.id and x.unit_id = $3)
        order by ${order} limit 1 for update of w skip locked`, [unit.listing_id, price, unitId])).rows[0] ?? null;
  }
  if (!cand) {
    await transition(tx, unitId, "available", { actor: o.actor, reason: "no eligible waitlist entry — relisted" });
    return null;
  }

  const expires = new Date(Math.min(now.getTime() + l.offer_window_minutes * 60_000, new Date(l.booking_deadline).getTime()));
  const offer = (await tx.query<any>(
    `insert into waitlist_offers(entry_id, listing_id, unit_id, customer_id, price_cents, source, buyback_offer_id, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [cand.id, unit.listing_id, unitId, cand.customer_id, price, o.source, o.buybackOfferId ?? null, expires])).rows[0];
  await transition(tx, unitId, "waitlisted", { actor: o.actor, reason: `offered to waitlist (${o.source})`, refType: "waitlist_offer", refId: offer.id });
  await tx.query("update waitlist_entries set status = 'offered', updated_at = now() where id = $1", [cand.id]);
  if (cand.notify_push || cand.notify_email || cand.notify_sms) {
    await notify(tx, cand.customer_id, {
      kind: "waitlist_offer", title: "A place just opened up for you",
      body: `${l.title} — ${fmtDateTime(l.starts_at)} for ${aud(price)} (before the service fee). Accept before ${fmtDateTime(expires)} or it goes to the next person.`,
      link: "/account/offers",
    });
  }
  return offer;
}

/** Customer B accepts a waitlist offer → unit is held for them and a payment is started. */
export async function acceptOffer(customerId: string, offerId: string, ip?: string | null): Promise<{ orderId: string }> {
  const res = await inTx(async (tx) => {
    const o = (await tx.query<any>("select * from waitlist_offers where id = $1 for update", [offerId])).rows[0];
    if (!o || o.customer_id !== customerId) throw new DomainError("NOT_FOUND", "Offer not found");
    if (o.status === "accepted") {
      const ex = (await tx.query<any>("select id from orders where waitlist_offer_id = $1", [offerId])).rows[0];
      if (ex) return { orderId: ex.id as string, fresh: false };
    }
    if (o.status !== "pending") throw new DomainError("EXPIRED", "This offer is no longer available");
    if (new Date(o.expires_at) <= new Date()) throw new DomainError("EXPIRED", "This offer has expired");
    const entry = (await tx.query<any>("select * from waitlist_entries where id = $1", [o.entry_id])).rows[0];
    const user = (await tx.query<any>("select name, email, phone from users where id = $1", [customerId])).rows[0];
    const until = new Date(Date.now() + (await holdMinutes(tx)) * 60_000);
    await transition(tx, o.unit_id, "held", { actor: customerId, reason: "waitlist offer accepted", heldBy: customerId, reservedUntil: until, refType: "waitlist_offer", refId: offerId });
    const order = await createOrder(tx, {
      customerId, listingId: o.listing_id, unitIds: [o.unit_id], source: o.source === "buyback" ? "buyback" : "waitlist",
      guests: Number(entry.preferences?.guests ?? 1), guestName: user.name, guestEmail: user.email, guestPhone: user.phone,
      buybackConsent: false, idempotencyKey: `offer:${offerId}`, reservedUntil: until, offerId, unitPriceCents: o.price_cents, ip,
    });
    await tx.query("update waitlist_offers set status = 'accepted', responded_at = now() where id = $1", [offerId]);
    await audit(tx, { id: customerId, role: "customer", ip }, "waitlist.offer_accepted", "waitlist_offer", offerId, { orderId: order.orderId });
    return { orderId: order.orderId, fresh: true };
  });
  await startPayment(res.orderId);
  return { orderId: res.orderId };
}

export async function declineOffer(customerId: string, offerId: string) {
  return inTx(async (tx) => {
    const o = (await tx.query<any>("select * from waitlist_offers where id = $1 for update", [offerId])).rows[0];
    if (!o || o.customer_id !== customerId) throw new DomainError("NOT_FOUND", "Offer not found");
    if (o.status !== "pending") throw new DomainError("EXPIRED", "This offer is no longer available");
    await closeOffer(tx, o, "declined");
  });
}

/** Marks a pending offer closed (declined/expired), returns the entry to the list, and passes the unit to the next person. */
export async function closeOffer(tx: Tx, o: any, status: "declined" | "expired") {
  await tx.query("update waitlist_offers set status = $2, responded_at = now() where id = $1", [o.id, status]);
  await tx.query("update waitlist_entries set status = 'active', updated_at = now() where id = $1 and status = 'offered'", [o.entry_id]);
  const next = await reofferUnit(tx, o.unit_id, { source: o.source, price: o.price_cents, buybackOfferId: o.buyback_offer_id });
  if (!next && o.source === "buyback" && o.buyback_offer_id) {
    const { onResaleFailed } = await import("./buyback");
    await onResaleFailed(tx, o.buyback_offer_id);
  }
}

/** Simple alternative workflow: a partner releases genuinely unsold / voluntarily cancelled inventory directly to the waitlist. */
export async function partnerReleaseToWaitlist(a: { partnerId: string; unitId: string; actor: Actor; priceCents?: number }) {
  return inTx(async (tx) => {
    const u = (await tx.query<any>("select u.*, l.min_price_cents, l.max_price_cents from inventory_units u join listings l on l.id = u.listing_id where u.id = $1 for update of u", [a.unitId])).rows[0];
    if (!u || u.partner_id !== a.partnerId) throw new DomainError("FORBIDDEN", "Not your inventory");
    if (!["available", "cancelled"].includes(u.status)) throw new DomainError("CONFLICT", `Only unsold or cancelled inventory can be released this way (this unit is ${u.status}). Booked rooms need the buyback workflow.`);
    if (a.priceCents != null && (a.priceCents < u.min_price_cents || a.priceCents > u.max_price_cents)) throw new DomainError("INVALID", "Price is outside your minimum/maximum");
    const wl = (await tx.query<any>("select count(*)::int n from waitlist_entries where listing_id = $1 and status = 'active'", [u.listing_id])).rows[0].n;
    if (wl === 0) throw new DomainError("INVALID", "Nobody is on the waitlist for this listing.");
    const offer = await reofferUnit(tx, a.unitId, { source: "release", price: a.priceCents, actor: a.actor.id });
    await audit(tx, a.actor, "inventory.release_to_waitlist", "inventory_unit", a.unitId, { offerId: offer?.id ?? null });
    return offer;
  });
}
