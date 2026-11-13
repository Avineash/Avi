import type { Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { allocate } from "@/lib/util";
import { makeRef } from "@/lib/ref";
import { gstOf, quoteFee } from "./fees";
import { featureOn, getSetting } from "./settings";
import { buybackOptInText } from "./legal";
import { getProvider } from "@/lib/providers/payments";

export interface OrderInput {
  customerId: string; listingId: string; unitIds: string[];
  source: "direct" | "waitlist" | "buyback";
  guests: number; guestName: string; guestEmail: string; guestPhone?: string | null; specialRequests?: string | null;
  buybackConsent: boolean; idempotencyKey: string; reservedUntil: Date;
  offerId?: string | null; unitPriceCents?: number; ip?: string | null;
}

/** Customer fee flow: buyback resales use their own (separately configurable) customer fee. */
export const customerFeeFlow = (source: string) => (source === "buyback" ? "buyback" : "booking") as "buyback" | "booking";
export const partnerFeeFlow = (source: string, category: string) =>
  (source === "buyback" ? (category === "event" ? "resale" : "buyback") : "booking") as "booking" | "buyback" | "resale";

/**
 * Creates an order, one pending reservation per held unit, and a pending payment — all in the caller's transaction.
 * Prices are locked here (the customer sees and pays exactly what was quoted when the hold was taken).
 */
export async function createOrder(tx: Tx, i: OrderInput) {
  const listing = (await tx.query<any>("select l.*, p.status as partner_status, p.gst_registered, p.buyback_enabled from listings l join partners p on p.id = l.partner_id where l.id = $1", [i.listingId])).rows[0];
  if (!listing) throw new DomainError("NOT_FOUND", "Listing not found");
  if (listing.partner_status !== "approved") throw new DomainError("EXPIRED", "This partner is not currently accepting bookings");

  const units = (await tx.query<any>("select id, price_override_cents, status, held_by from inventory_units where id = any($1::uuid[]) order by label", [i.unitIds])).rows;
  if (units.length !== i.unitIds.length || units.some((u) => u.status !== "held" || u.held_by !== i.customerId)) throw new DomainError("CONFLICT", "Inventory is no longer held for you");

  const prices = units.map((u) => i.unitPriceCents ?? u.price_override_cents ?? listing.current_price_cents);
  const subtotal = prices.reduce((a: number, b: number) => a + b, 0);
  const custFee = await quoteFee(tx, { payer: "customer", flow: customerFeeFlow(i.source), category: listing.category, partnerId: listing.partner_id, basisCents: subtotal });
  const fees = allocate(custFee.amount, prices);
  const provider = getProvider();

  const order = (await tx.query<any>(
    `insert into orders(reference, customer_id, source, subtotal_cents, customer_fee_cents, total_cents, idempotency_key, expires_at, waitlist_offer_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, reference, total_cents`,
    [makeRef("EH"), i.customerId, i.source, subtotal, custFee.amount, subtotal + custFee.amount, i.idempotencyKey, i.reservedUntil, i.offerId ?? null])).rows[0];

  const consentAllowed = i.buybackConsent && listing.buyback_eligible && listing.buyback_enabled && (await featureOn(tx, "features.buyback"));
  const termsVersion = (await getSetting<{ version: string }>(tx, "legal.terms_version", { version: "unversioned" })).version;
  const reservationIds: string[] = [];
  for (let n = 0; n < units.length; n++) {
    const r = (await tx.query<any>(
      `insert into reservations(reference, order_id, customer_id, listing_id, unit_id, partner_id, price_cents, customer_fee_cents, total_cents, gst_cents,
                                guests, guest_name, guest_email, guest_phone, special_requests, cancellation_policy, buyback_consent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [makeRef("RS"), order.id, i.customerId, i.listingId, units[n].id, listing.partner_id, prices[n], fees[n], prices[n] + fees[n],
       listing.gst_registered ? gstOf(prices[n]) : 0, i.guests, i.guestName, i.guestEmail, i.guestPhone ?? null, i.specialRequests ?? null,
       listing.cancellation_policy, consentAllowed])).rows[0];
    reservationIds.push(r.id);
    if (consentAllowed) {
      await tx.query("insert into buyback_consents(reservation_id, customer_id, kind, terms_version, terms_snapshot, ip) values ($1,$2,'checkout_opt_in',$3,$4,$5)",
        [r.id, i.customerId, termsVersion, buybackOptInText(termsVersion), i.ip ?? null]);
    }
  }
  await tx.query("insert into payments(order_id, provider, amount_cents, idempotency_key) values ($1,$2,$3,$4)",
    [order.id, provider.name, order.total_cents, `pay:${i.idempotencyKey}`]);
  return { orderId: order.id as string, reference: order.reference as string, totalCents: order.total_cents as number, reservationIds };
}
