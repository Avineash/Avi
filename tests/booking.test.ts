import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createCheckout, onPaymentAuthorized, sandboxPay } from "@/lib/domain/booking";
import { runMaintenance } from "@/lib/domain/maintenance";
import { reconcile } from "@/lib/domain/finance";
import { DomainError } from "@/lib/errors";
import { book, freshDb, mkListing, mkPartner, mkUser, unitStatuses } from "./helpers";

let pt: Awaited<ReturnType<typeof mkPartner>>;
beforeAll(async () => { await freshDb(); pt = await mkPartner(); });

const input = (customerId: string, listingId: string, key: string, quantity = 1) =>
  ({ customerId, listingId, quantity, guests: 2, guestName: "G", guestEmail: "g@test.example", buybackConsent: false, idempotencyKey: key });

describe("atomic reservation / double-booking prevention", () => {
  it("lets exactly one of many concurrent customers take the last unit", async () => {
    const listing = await mkListing(pt, { units: 1 });
    const customers = await Promise.all(Array.from({ length: 8 }, () => mkUser()));
    const results = await Promise.allSettled(customers.map((c, i) => createCheckout(input(c, listing, `race-${i}`))));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(7);
    expect(failed.every((f) => f.reason instanceof DomainError && f.reason.code === "SOLD_OUT")).toBe(true);
    expect(await unitStatuses(listing)).toEqual(["held"]);
  });

  it("never allocates the same unit twice across concurrent multi-unit checkouts", async () => {
    const listing = await mkListing(pt, { units: 6 });
    const customers = await Promise.all(Array.from({ length: 4 }, () => mkUser()));
    const results = await Promise.allSettled(customers.map((c, i) => createCheckout(input(c, listing, `multi-${i}`, 2))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3); // 6 units / 2 per booking
    const db = await getDb();
    const dup = await db.query("select unit_id from reservations where listing_id = $1 and status = 'pending_payment' group by unit_id having count(*) > 1", [listing]);
    expect(dup.rows).toHaveLength(0);
  });

  it("is enforced by the database even if application code is bypassed", async () => {
    const listing = await mkListing(pt, { units: 1 });
    const { reservation } = await book(await mkUser(), listing);
    const db = await getDb();
    await expect(db.query(
      `insert into reservations(reference, order_id, customer_id, listing_id, unit_id, partner_id, price_cents, customer_fee_cents, total_cents, cancellation_policy)
       values ('X', $1, $2, $3, $4, $5, 100, 0, 100, 'flexible')`, [reservation.order_id, reservation.customer_id, listing, reservation.unit_id, pt.partnerId])).rejects.toThrow(/reservations_one_live_per_unit|duplicate key/);
  });

  it("is idempotent: the same key returns the same order and holds only one unit", async () => {
    const listing = await mkListing(pt, { units: 3 });
    const c = await mkUser();
    const [a, b] = await Promise.all([createCheckout(input(c, listing, "same-key")), createCheckout(input(c, listing, "same-key")).catch((e) => e)]);
    const again = await createCheckout(input(c, listing, "same-key"));
    expect(again.orderId).toBe(a.orderId);
    if (!(b instanceof Error)) expect(b.orderId).toBe(a.orderId);
    expect((await unitStatuses(listing)).filter((s) => s === "held")).toHaveLength(1);
  });

  it("rejects an idempotency key reused by a different customer", async () => {
    const listing = await mkListing(pt, { units: 2 });
    await createCheckout(input(await mkUser(), listing, "shared-key"));
    await expect(createCheckout(input(await mkUser(), listing, "shared-key"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("payment → confirmation", () => {
  it("captures, books the unit, records fees + ledger and reconciles to the cent", async () => {
    const listing = await mkListing(pt, { units: 1, priceCents: 18000 });
    const { reservation } = await book(await mkUser(), listing);
    expect(reservation.status).toBe("confirmed");
    expect(await unitStatuses(listing)).toEqual(["booked"]);
    const db = await getDb();
    const fees = (await db.query<any>("select kind, amount_cents from platform_fees where reservation_id = $1 order by kind", [reservation.id])).rows;
    expect(fees.map((f) => f.kind)).toEqual(["commission", "customer_fee"]);
    expect(fees.find((f) => f.kind === "commission").amount_cents).toBe(2700); // 15% hotel rule from fee_rules (data, not code)
    expect(reservation.total_cents).toBe(reservation.price_cents + reservation.customer_fee_cents);
    const rec = await reconcile(db);
    expect(rec.balanced).toBe(true);
  });

  it("a declined card keeps the hold; a good card then succeeds", async () => {
    const listing = await mkListing(pt, { units: 1 });
    const c = await mkUser();
    const { orderId } = await createCheckout(input(c, listing, "decline"));
    await expect(sandboxPay({ orderId, customerId: c, cardNumber: "4000000000000002" })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    expect(await unitStatuses(listing)).toEqual(["held"]);
    await sandboxPay({ orderId, customerId: c, cardNumber: "4242 4242 4242 4242" });
    expect(await unitStatuses(listing)).toEqual(["booked"]);
  });

  it("duplicate authorisation webhooks do not double-book or double-charge fees", async () => {
    const listing = await mkListing(pt, { units: 1 });
    const c = await mkUser();
    const { orderId } = await createCheckout(input(c, listing, "dup-webhook"));
    const db = await getDb();
    const ref = (await db.query<any>("select provider_ref from payments where order_id = $1", [orderId])).rows[0].provider_ref;
    const res = await Promise.all([onPaymentAuthorized("sandbox", ref), onPaymentAuthorized("sandbox", ref), onPaymentAuthorized("sandbox", ref)]);
    expect(res.every((r) => r === "confirmed")).toBe(true);
    const fees = await db.query("select 1 from platform_fees where order_id = $1", [orderId]);
    expect(fees.rows).toHaveLength(2);
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("an expired hold is released by the sweeper and a late authorisation is voided, not booked", async () => {
    const listing = await mkListing(pt, { units: 1 });
    const c = await mkUser();
    const { orderId } = await createCheckout(input(c, listing, "expire"));
    const db = await getDb();
    await db.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [orderId]);
    await db.query("update inventory_units set reserved_until = now() - interval '1 minute' where listing_id = $1", [listing]);
    const s = await runMaintenance();
    expect(s.expiredOrders).toBeGreaterThanOrEqual(1);
    expect(await unitStatuses(listing)).toEqual(["available"]);
    // customer B grabs it
    const other = await mkUser();
    await createCheckout(input(other, listing, "after-expiry"));
    // the first customer's authorisation lands late
    const ref = (await db.query<any>("select provider_ref from payments where order_id = $1", [orderId])).rows[0].provider_ref;
    expect(await onPaymentAuthorized("sandbox", ref)).toBe("voided");
    const st = (await db.query<any>("select status from payments where order_id = $1", [orderId])).rows[0].status;
    expect(st).toBe("cancelled");
    expect((await db.query("select 1 from reservations where order_id = $1 and status = 'confirmed'", [orderId])).rows).toHaveLength(0);
  });

  it("cannot book a closed listing or past the booking deadline", async () => {
    const listing = await mkListing(pt, { units: 1 });
    const db = await getDb();
    await db.query("update listings set status = 'paused' where id = $1", [listing]);
    await expect(createCheckout(input(await mkUser(), listing, "paused"))).rejects.toMatchObject({ code: "EXPIRED" });
  });
});
