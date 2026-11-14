import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { setSetting } from "@/lib/domain/settings";
import { onPaymentAuthorized, sandboxPay } from "@/lib/domain/booking";
import { reconcile } from "@/lib/domain/finance";
import { runMaintenance } from "@/lib/domain/maintenance";
import { cancelResaleOrder, confirmReceipt, createBuyerAlert, deliverResaleOrder, getResaleDetail, openResaleDispute, resolveResaleDispute, runSellerPayout, searchResale, sellerBalance, submitSellerReview } from "@/lib/domain/resale";
import { sandboxFaults } from "@/lib/providers/payments";
import { hours } from "@/lib/util";
import { buy, checkout, enableResale, freshDb, listItem, mkRegisteredVenue, mkSeller, mkUser, roRow } from "./helpers";

beforeAll(async () => { await freshDb(); });
beforeEach(async () => { await enableResale(true); });
const listing = async (id: string) => (await (await getDb()).query<any>("select * from resale_listings where id = $1", [id])).rows[0];
const deliver = (sellerId: string, orderId: string) => deliverResaleOrder({ sellerId, orderId, notes: "Booking name changed to the buyer — confirmation emailed" });
const ops = { id: null, role: "ops" };

describe("listing rules — registered venues only", () => {
  it("is switched off until the legal-review reference is recorded", async () => {
    await enableResale(false);
    const v = await mkRegisteredVenue(); const s = await mkSeller();
    await expect(listItem(s, v)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("needs a seller profile", async () => {
    const v = await mkRegisteredVenue();
    await expect(listItem(await mkUser(), v)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is impossible at a venue whose partner isn't registered and approved", async () => {
    const s = await mkSeller();
    for (const status of ["pending", "suspended", "rejected"]) {
      const v = await mkRegisteredVenue({ partnerStatus: status });
      await expect(listItem(s, v)).rejects.toMatchObject({ code: "NOT_ELIGIBLE", message: expect.stringMatching(/registered/) });
    }
    const unreg = await mkRegisteredVenue(); // active registry entry
    await expect(listItem(s, unreg)).resolves.toBeTruthy();
  });

  it("respects a venue that doesn't permit resale", async () => {
    const v = await mkRegisteredVenue({ resaleAllowed: false });
    await expect(listItem(await mkSeller(), v)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("caps the asking price: hotels at face value, events at the legal multiple", async () => {
    const s = await mkSeller();
    const hotel = await mkRegisteredVenue({ category: "hotel" });
    await expect(listItem(s, hotel, { originalUnitCents: 20000, askUnitCents: 20001 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(listItem(s, hotel, { originalUnitCents: 20000, askUnitCents: 20000 })).resolves.toBeTruthy();
    const event = await mkRegisteredVenue({ category: "event" });
    await expect(listItem(s, event, { originalUnitCents: 10000, askUnitCents: 11001 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(listItem(s, event, { originalUnitCents: 10000, askUnitCents: 11000 })).resolves.toBeTruthy();
  });

  it("refuses duplicates of the same booking, but the same reference at another venue is fine", async () => {
    const s = await mkSeller(); const v1 = await mkRegisteredVenue(); const v2 = await mkRegisteredVenue();
    await listItem(s, v1, { bookingReference: "ABC-123" });
    await expect(listItem(await mkSeller("Other"), v1, { bookingReference: "abc 123" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(listItem(s, v2, { bookingReference: "ABC-123" })).resolves.toBeTruthy();
  });

  it("validates timing, proof and declarations", async () => {
    const s = await mkSeller(); const v = await mkRegisteredVenue();
    await expect(listItem(s, v, { startsAt: new Date(Date.now() + hours(1)), endsAt: new Date(Date.now() + hours(5)) })).rejects.toMatchObject({ code: "INVALID" });
    await expect(listItem(s, v, { proof: null })).rejects.toMatchObject({ code: "INVALID" });
    await expect(listItem(s, v, { proof: { fileName: "x.exe", mime: "application/x-msdownload", content: Buffer.from("x") } })).rejects.toMatchObject({ code: "INVALID" });
    await expect(listItem(s, v, { declarations: { holder: true, permitted: false, deliver: true, accurate: true } })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("limits how many live listings one seller can have", async () => {
    const db = await getDb();
    await setSetting(db, "resale.rules", { hold_minutes: 10, delivery_hours: 24, cutoff_hours_before_start: 2, release_after_start_hours: 24, min_release_after_delivery_hours: 12, max_open_listings: 2, max_strikes: 3, dispute_hours_after_start: 24 }, null);
    const s = await mkSeller(); const v = await mkRegisteredVenue();
    await listItem(s, v); await listItem(s, v);
    await expect(listItem(s, v)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await setSetting(db, "resale.rules", { hold_minutes: 10, delivery_hours: 24, cutoff_hours_before_start: 2, release_after_start_hours: 24, min_release_after_delivery_hours: 12, max_open_listings: 20, max_strikes: 3, dispute_hours_after_start: 24 }, null);
  });
});

describe("discovery", () => {
  it("shows savings and the all-in price from the fee rules, and hides listings of unregistered partners", async () => {
    const v = await mkRegisteredVenue(); const s = await mkSeller();
    const id = await listItem(s, v, { originalUnitCents: 25000, askUnitCents: 20000 });
    const found = (await searchResale({ ids: [id] }))[0];
    expect(found.delta_pct).toBe(20);
    expect(found.buyer_fee_unit_cents).toBe(1000);          // 5% rule
    expect(found.total_unit_cents).toBe(21000);
    const db = await getDb();
    await db.query("update partners set status = 'suspended' where id = $1", [v.partnerId]);
    expect(await searchResale({ ids: [id] })).toHaveLength(0);
    expect((await getResaleDetail(id))?.sellable).toBe(false);
    await expect(checkout(await mkUser(), id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });
});

describe("checkout — no overselling", () => {
  it("gives the last unit to exactly one of many concurrent buyers", async () => {
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const buyers = await Promise.all(Array.from({ length: 6 }, () => mkUser()));
    const res = await Promise.allSettled(buyers.map((b, i) => checkout(b, id, { key: `race-${id}-${i}` })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).every((r) => ["SOLD_OUT", "EXPIRED"].includes(r.reason.code))).toBe(true);
    expect(await listing(id)).toMatchObject({ quantity_available: 0, status: "sold_out" });
  });

  it("enforces quantity, blocks self-purchase and is idempotent per key", async () => {
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v, { quantity: 3 });
    await expect(checkout(s, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const b = await mkUser();
    await expect(checkout(b, id, { quantity: 4 })).rejects.toMatchObject({ code: "SOLD_OUT" });
    const a = await checkout(b, id, { quantity: 2, key: "same" });
    expect((await checkout(b, id, { quantity: 2, key: "same" })).orderId).toBe(a.orderId);
    expect((await listing(id)).quantity_available).toBe(1);
    await expect(checkout(await mkUser(), id, { key: "same" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("releases stock when an unpaid hold expires; a late authorisation is voided, not honoured", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await checkout(b, id);
    await db.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [r.orderId]);
    await runMaintenance();
    expect(await listing(id)).toMatchObject({ quantity_available: 1, status: "active" });
    expect((await roRow(r.resaleOrderId)).status).toBe("expired");
    const ref = (await db.query<any>("select provider_ref from payments where order_id = $1", [r.orderId])).rows[0].provider_ref;
    expect(await onPaymentAuthorized("sandbox", ref)).toBe("voided");
    expect((await roRow(r.resaleOrderId)).status).toBe("expired");
  });

  it("a declined card keeps the hold; a good card then books it", async () => {
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await checkout(b, id);
    await expect(sandboxPay({ orderId: r.orderId, customerId: b, cardNumber: "4000000000000002" })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    expect((await listing(id)).quantity_available).toBe(0);
    await sandboxPay({ orderId: r.orderId, customerId: b, cardNumber: "4242424242424242" });
    expect((await roRow(r.resaleOrderId)).status).toBe("paid");
  });

  it("charges fees from editable rules (buyer 5%, seller 8% by default)", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v, { askUnitCents: 18000 });
    const r = await buy(await mkUser(), id);
    expect(await roRow(r.resaleOrderId)).toMatchObject({ subtotal_cents: 18000, buyer_fee_cents: 900, seller_fee_cents: 1440, total_cents: 18900 });
    await db.query("update fee_rules set active = false where payer = 'seller' and applies_to = 'peer_resale'");
    await db.query("insert into fee_rules(payer, applies_to, scope, kind, rate_bps) values ('seller','peer_resale','global','percentage',1000)");
    const id2 = await listItem(s, v, { askUnitCents: 18000 });
    expect((await roRow((await buy(await mkUser(), id2)).resaleOrderId)).seller_fee_cents).toBe(1800);
    await db.query("update fee_rules set active = false where payer = 'seller' and applies_to = 'peer_resale'");
    await db.query("insert into fee_rules(payer, applies_to, scope, kind, rate_bps) values ('seller','peer_resale','global','percentage',800)");
  });
});

describe("escrow lifecycle", () => {
  it("holds funds until delivery is confirmed, then releases them and pays the seller out once", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v, { askUnitCents: 18000 });
    const b = await mkUser(); const r = await buy(b, id);
    expect(await roRow(r.resaleOrderId)).toMatchObject({ status: "paid" });
    expect(await sellerBalance(db, s)).toEqual({ escrow: 16560, available: 0, paidOut: 0 });
    expect((await reconcile(db)).balanced).toBe(true);

    await expect(confirmReceipt(b, r.resaleOrderId)).rejects.toMatchObject({ code: "CONFLICT" });   // nothing delivered yet
    await expect(deliver(await mkUser(), r.resaleOrderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deliver(s, r.resaleOrderId);
    expect((await roRow(r.resaleOrderId)).status).toBe("delivered");
    await expect(confirmReceipt(await mkUser(), r.resaleOrderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await confirmReceipt(b, r.resaleOrderId);
    expect((await roRow(r.resaleOrderId)).status).toBe("completed");
    expect(await sellerBalance(db, s)).toEqual({ escrow: 0, available: 16560, paidOut: 0 });

    const p = await runSellerPayout(s);
    expect(p).toMatchObject({ status: "paid", net_cents: 16560 });
    await expect(runSellerPayout(s)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await sellerBalance(db, s)).toEqual({ escrow: 0, available: 0, paidOut: 16560 });
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("auto-releases after the event starts when nobody reports a problem", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await buy(b, id); await deliver(s, r.resaleOrderId);
    await runMaintenance();
    expect((await roRow(r.resaleOrderId)).status).toBe("delivered");     // too early
    await db.query("update resale_orders set auto_release_at = now() - interval '1 minute' where id = $1", [r.resaleOrderId]);
    await runMaintenance();
    expect((await roRow(r.resaleOrderId)).status).toBe("completed");
    expect((await sellerBalance(db, s)).available).toBeGreaterThan(0);
  });

  it("only completed sales can be reviewed, once, and the rating shows in search", async () => {
    const v = await mkRegisteredVenue(); const s = await mkSeller("Rated Seller"); const id = await listItem(s, v, { quantity: 2 });
    const b = await mkUser(); const r = await buy(b, id);
    await expect(submitSellerReview({ buyerId: b, orderId: r.resaleOrderId, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    await deliver(s, r.resaleOrderId); await confirmReceipt(b, r.resaleOrderId);
    await submitSellerReview({ buyerId: b, orderId: r.resaleOrderId, rating: 4, comment: "Smooth" });
    await expect(submitSellerReview({ buyerId: b, orderId: r.resaleOrderId, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    const card = (await searchResale({ ids: [id] }))[0];
    expect(card).toMatchObject({ seller_rating: 4, seller_reviews: 1, seller_sales: 1 });
  });
});

describe("failure paths protect the buyer", () => {
  it("a seller who doesn't deliver in time triggers a full automatic refund, a strike and relisting", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await buy(b, id);
    await db.query("update resale_orders set deliver_by = now() - interval '1 minute' where id = $1", [r.resaleOrderId]);
    await runMaintenance();
    const ro = await roRow(r.resaleOrderId);
    expect(ro.status).toBe("refunded");
    expect((await db.query<any>("select status, refunded_cents, captured_cents from payments where order_id = $1", [r.orderId])).rows[0]).toMatchObject({ status: "refunded" });
    expect((await db.query<any>("select strikes from seller_profiles where user_id = $1", [s])).rows[0].strikes).toBe(1);
    expect(await listing(id)).toMatchObject({ quantity_available: 1, status: "active" });
    expect(await sellerBalance(db, s)).toEqual({ escrow: 0, available: 0, paidOut: 0 });
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("repeated failures suspend the seller and pause their listings", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller("Flaky");
    const ids = [await listItem(s, v), await listItem(s, v), await listItem(s, v), await listItem(s, v)];
    for (const id of ids.slice(0, 3)) { const r = await buy(await mkUser(), id); await cancelResaleOrder({ actorId: s, orderId: r.resaleOrderId, as: "seller" }); }
    expect((await db.query<any>("select status, strikes from seller_profiles where user_id = $1", [s])).rows[0]).toMatchObject({ status: "suspended", strikes: 3 });
    expect((await listing(ids[3])).status).toBe("paused");
    await expect(listItem(s, v)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(checkout(await mkUser(), ids[3])).rejects.toBeTruthy();
  });

  it("the buyer can cancel before delivery with a full refund and no strike; not after delivery", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await buy(b, id);
    await expect(cancelResaleOrder({ actorId: await mkUser(), orderId: r.resaleOrderId, as: "buyer" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await cancelResaleOrder({ actorId: b, orderId: r.resaleOrderId, as: "buyer" });
    expect((await roRow(r.resaleOrderId)).status).toBe("cancelled");
    expect((await db.query<any>("select strikes from seller_profiles where user_id = $1", [s])).rows[0].strikes).toBe(0);
    expect((await listing(id)).quantity_available).toBe(1);
    const r2 = await buy(b, id); await deliver(s, r2.resaleOrderId);
    await expect(cancelResaleOrder({ actorId: b, orderId: r2.resaleOrderId, as: "buyer" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("a provider refund failure leaves the order 'refunding' until the reconciler succeeds", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await buy(b, id);
    sandboxFaults.refund = 1;
    await cancelResaleOrder({ actorId: b, orderId: r.resaleOrderId, as: "buyer" });
    expect((await roRow(r.resaleOrderId)).status).toBe("refunding");
    expect((await listing(id)).quantity_available).toBe(0);                 // stock not restored until the money moved
    await runMaintenance();
    expect((await roRow(r.resaleOrderId)).status).toBe("cancelled");
    expect((await listing(id)).quantity_available).toBe(1);
    expect((await reconcile(db)).balanced).toBe(true);
  });
});

describe("disputes", () => {
  async function delivered() {
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await buy(b, id); await deliver(s, r.resaleOrderId);
    return { s, b, id, r };
  }
  it("freeze the escrow: auto-release never happens while a dispute is open", async () => {
    const db = await getDb();
    const { b, r } = await delivered();
    await expect(openResaleDispute({ buyerId: await mkUser(), orderId: r.resaleOrderId, reason: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await openResaleDispute({ buyerId: b, orderId: r.resaleOrderId, reason: "Ticket was already used", details: "Scanned at the door" });
    await db.query("update resale_orders set auto_release_at = now() - interval '1 hour' where id = $1", [r.resaleOrderId]);
    await runMaintenance();
    expect((await roRow(r.resaleOrderId)).status).toBe("disputed");
  });
  it("can only be raised after delivery", async () => {
    const v = await mkRegisteredVenue(); const s = await mkSeller(); const id = await listItem(s, v);
    const b = await mkUser(); const r = await buy(b, id);
    await expect(openResaleDispute({ buyerId: b, orderId: r.resaleOrderId, reason: "not yet delivered" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("resolved for the buyer: full refund, seller struck, books balanced", async () => {
    const db = await getDb();
    const { s, b, id, r } = await delivered();
    await openResaleDispute({ buyerId: b, orderId: r.resaleOrderId, reason: "Booking was invalid" });
    const d = (await db.query<any>("select id from resale_disputes where resale_order_id = $1", [r.resaleOrderId])).rows[0];
    await resolveResaleDispute({ disputeId: d.id, outcome: "refund_buyer", note: "Venue confirmed the booking was cancelled", actor: ops });
    expect((await roRow(r.resaleOrderId)).status).toBe("refunded");
    expect((await db.query<any>("select strikes from seller_profiles where user_id = $1", [s])).rows[0].strikes).toBe(1);
    expect((await listing(id)).quantity_available).toBe(1);
    expect((await sellerBalance(db, s)).escrow).toBe(0);
    expect((await reconcile(db)).balanced).toBe(true);
    await expect(resolveResaleDispute({ disputeId: d.id, outcome: "release_seller", note: "again", actor: ops })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("resolved for the seller: funds released, buyer told", async () => {
    const db = await getDb();
    const { s, b, r } = await delivered();
    await openResaleDispute({ buyerId: b, orderId: r.resaleOrderId, reason: "Changed my mind" });
    const d = (await db.query<any>("select id from resale_disputes where resale_order_id = $1", [r.resaleOrderId])).rows[0];
    await resolveResaleDispute({ disputeId: d.id, outcome: "release_seller", note: "Delivery was valid", actor: ops });
    expect((await roRow(r.resaleOrderId)).status).toBe("completed");
    expect((await sellerBalance(db, s)).available).toBeGreaterThan(0);
    expect((await db.query("select 1 from notifications where user_id = $1 and kind = 'resale_dispute_closed'", [b])).rows).toHaveLength(1);
  });
});

describe("buyer alerts (the secondary-market waitlist)", () => {
  it("notifies a buyer when a matching listing appears, and not for non-matches", async () => {
    const db = await getDb();
    const v = await mkRegisteredVenue({ category: "event" }); const s = await mkSeller();
    const want = await mkUser(), tooCheap = await mkUser(), wrongCat = await mkUser();
    await createBuyerAlert({ buyerId: want, category: "event", maxUnitCents: 15000 });
    await createBuyerAlert({ buyerId: tooCheap, category: "event", maxUnitCents: 1000 });
    await createBuyerAlert({ buyerId: wrongCat, category: "hotel" });
    await listItem(s, v, { originalUnitCents: 10000, askUnitCents: 9000 });
    const n = async (u: string) => (await db.query<any>("select count(*)::int n from notifications where user_id = $1 and kind = 'alert_match'", [u])).rows[0].n;
    expect([await n(want), await n(tooCheap), await n(wrongCat)]).toEqual([1, 0, 0]);
    await expect(createBuyerAlert({ buyerId: want })).rejects.toMatchObject({ code: "INVALID" });
  });
});
