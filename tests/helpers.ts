import { createTestDb, __setDb, getDb, inTx, type Db } from "@/lib/db";
import { createListing, createVenue } from "@/lib/domain/catalog";
import { setSetting } from "@/lib/domain/settings";
import { createCheckout, sandboxPay } from "@/lib/domain/booking";
import { hours } from "@/lib/util";

export async function freshDb(): Promise<Db> {
  const db = await createTestDb();
  __setDb(Promise.resolve(db));
  return db;
}

let n = 0;
export async function mkUser(role: "customer" | "partner" | "admin" = "customer", name?: string) {
  const db = await getDb();
  n++;
  const r = await db.query<any>("insert into users(email, name, role, password_hash) values ($1,$2,$3,'x') returning id", [`u${n}-${Math.random().toString(36).slice(2, 6)}@test.example`, name ?? `User ${n}`, role]);
  return r.rows[0].id as string;
}

export async function mkPartner(o: { category?: "hotel" | "restaurant" | "event"; buyback?: boolean; policy?: "first_come" | "highest_offer"; thresholdCents?: number; offerMinutes?: number } = {}) {
  const db = await getDb();
  const owner = await mkUser("partner", "Owner");
  const p = (await db.query<any>(
    `insert into partners(owner_user_id, business_name, abn, category, status, buyback_enabled, waitlist_policy, buyback_approval_threshold_cents, offer_window_minutes)
     values ($1,'Test Partner','51824753556',$2,'approved',$3,$4,$5,$6) returning id`,
    [owner, o.category ?? "hotel", o.buyback ?? true, o.policy ?? "first_come", o.thresholdCents ?? 20000, o.offerMinutes ?? 30])).rows[0];
  const venue = await createVenue(db, { partnerId: p.id, name: "Test Hotel", category: o.category ?? "hotel", address: "1 Collins St", suburb: "Melbourne CBD", lat: -37.81, lng: 144.96 });
  return { partnerId: p.id as string, ownerId: owner, venueId: venue };
}

export async function mkListing(pt: { partnerId: string; venueId: string }, o: Partial<Parameters<typeof createListing>[1]> = {}) {
  return inTx((tx) => createListing(tx, {
    partnerId: pt.partnerId, venueId: pt.venueId, title: "Deluxe King", startsAt: new Date(Date.now() + hours(30)), endsAt: new Date(Date.now() + hours(54)),
    bookingDeadline: new Date(Date.now() + hours(29)), originalCents: 30000, minCents: 10000, maxCents: 40000, priceCents: 18000, units: 1,
    buybackEligible: true, cancellationPolicy: "flexible", status: "published", ...o,
  }));
}

export async function enableBuyback(on = true) {
  const db = await getDb();
  await setSetting(db, "features.buyback", { enabled: on, legal_review_ref: on ? "TEST-LEGAL-001" : null }, null);
  await setSetting(db, "features.event_resale", { enabled: on, legal_review_ref: on ? "TEST-LEGAL-002" : null, cap_bps: 11000 }, null);
}

let k = 0;
/** Customer books (and pays) one unit through the real checkout path. */
export async function book(customerId: string, listingId: string, o: { quantity?: number; consent?: boolean; key?: string } = {}) {
  const { orderId } = await createCheckout({
    customerId, listingId, quantity: o.quantity ?? 1, guests: 2, guestName: "Guest", guestEmail: "g@test.example",
    buybackConsent: o.consent ?? true, idempotencyKey: o.key ?? `test-${++k}-${Math.random()}`,
  });
  await sandboxPay({ orderId, customerId, cardNumber: "4242424242424242" });
  const db = await getDb();
  const res = (await db.query<any>("select * from reservations where order_id = $1 order by created_at", [orderId])).rows;
  return { orderId, reservation: res[0], reservations: res };
}

export async function joinList(customerId: string, listingId: string, maxCents?: number) {
  const { joinWaitlist } = await import("@/lib/domain/waitlist");
  return joinWaitlist({ customerId, listingId, maxPriceCents: maxCents ?? null });
}

export async function unitStatuses(listingId: string) {
  const db = await getDb();
  return (await db.query<any>("select label, status from inventory_units where listing_id = $1 order by label", [listingId])).rows.map((r) => r.status as string);
}
