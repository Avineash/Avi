import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { cancelReservation, issueManualRefund } from "@/lib/domain/booking";
import { reconcile, requestRefund, decideRefundRequest } from "@/lib/domain/finance";
import { runMaintenance } from "@/lib/domain/maintenance";
import { sandboxFaults } from "@/lib/providers/payments";
import { hours } from "@/lib/util";
import { book, freshDb, mkListing, mkPartner, mkUser, unitStatuses } from "./helpers";

let pt: Awaited<ReturnType<typeof mkPartner>>;
beforeAll(async () => { await freshDb(); pt = await mkPartner(); });

const ledgerNet = async (reservationId: string) => Number((await (await getDb()).query<any>("select coalesce(sum(amount_cents),0) s from ledger_entries where reservation_id = $1", [reservationId])).rows[0].s);

describe("cancellation & refunds", () => {
  it("flexible: full refund (including service fee) before the cutoff; partner ledger nets to zero", async () => {
    const listing = await mkListing(pt, { cancellationPolicy: "flexible" });
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    const out = await cancelReservation({ reservationId: reservation.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "Plans changed", asCustomer: true });
    expect(out.refundCents).toBe(reservation.total_cents);
    expect(await ledgerNet(reservation.id)).toBe(0);
    expect(await unitStatuses(listing)).toEqual(["available"]); // no waitlist → straight back on sale
    const db = await getDb();
    expect((await db.query<any>("select status, refunded_cents, captured_cents from payments where order_id = $1", [reservation.order_id])).rows[0]).toMatchObject({ status: "refunded" });
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("moderate inside 24h: 50% refund, partner keeps the rest, platform fee reversed proportionally", async () => {
    const listing = await mkListing(pt, { cancellationPolicy: "moderate", startsAt: new Date(Date.now() + hours(10)), endsAt: new Date(Date.now() + hours(30)), bookingDeadline: new Date(Date.now() + hours(9)) });
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    const out = await cancelReservation({ reservationId: reservation.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true });
    expect(out.refundCents).toBe(Math.round(reservation.total_cents / 2));
    const db = await getDb();
    expect((await db.query<any>("select status from payments where order_id = $1", [reservation.order_id])).rows[0].status).toBe("partially_refunded");
    expect(await ledgerNet(reservation.id)).toBeGreaterThan(0);
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("non-refundable: no refund, the inventory is still released for resale", async () => {
    const listing = await mkListing(pt, { cancellationPolicy: "non_refundable" });
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    const out = await cancelReservation({ reservationId: reservation.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true });
    expect(out.refundCents).toBe(0);
    expect(await unitStatuses(listing)).toEqual(["available"]);
    expect((await reconcile(await getDb())).balanced).toBe(true);
  });

  it("only the owner can cancel, only once, and not after the start", async () => {
    const listing = await mkListing(pt);
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    await expect(cancelReservation({ reservationId: reservation.id, actor: { id: await mkUser(), role: "customer" }, mode: "policy", reason: "x", asCustomer: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelReservation({ reservationId: reservation.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true });
    await expect(cancelReservation({ reservationId: reservation.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true })).rejects.toMatchObject({ code: "CONFLICT" });
    const l2 = await mkListing(pt);
    const r2 = (await book(c, l2)).reservation;
    await (await getDb()).query("update listings set starts_at = now() - interval '1 hour', ends_at = now() + interval '5 hours', booking_deadline = now() - interval '2 hours' where id = $1", [l2]);
    await expect(cancelReservation({ reservationId: r2.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a failed provider refund leaves the unit un-released until the reconciler succeeds", async () => {
    const listing = await mkListing(pt);
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    sandboxFaults.refund = 1;
    await cancelReservation({ reservationId: reservation.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true });
    const db = await getDb();
    expect(await unitStatuses(listing)).toEqual(["cancelled"]); // NOT released while money is outstanding
    expect((await db.query<any>("select status from refunds where reservation_id = $1", [reservation.id])).rows[0].status).toBe("pending");
    await db.query("update refunds set created_at = now() - interval '5 minutes' where reservation_id = $1", [reservation.id]);
    await runMaintenance();
    expect(await unitStatuses(listing)).toEqual(["available"]);
    expect((await db.query<any>("select status from refunds where reservation_id = $1", [reservation.id])).rows[0].status).toBe("succeeded");
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("goodwill refunds are capped at the remaining amount and idempotent per key", async () => {
    const listing = await mkListing(pt);
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    const admin = { id: await mkUser("admin"), role: "admin" };
    const a = await issueManualRefund({ reservationId: reservation.id, amountCents: 3000, reason: "service issue", actor: admin, idempotencyKey: "k1" });
    const b = await issueManualRefund({ reservationId: reservation.id, amountCents: 3000, reason: "service issue", actor: admin, idempotencyKey: "k1" });
    expect(b).toBe(a);
    await expect(issueManualRefund({ reservationId: reservation.id, amountCents: reservation.total_cents, reason: "too much", actor: admin, idempotencyKey: "k2" })).rejects.toMatchObject({ code: "INVALID" });
    const db = await getDb();
    expect(Number((await db.query<any>("select refunded_cents from payments where order_id = $1", [reservation.order_id])).rows[0].refunded_cents)).toBe(3000);
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("exceptional refund requests need an admin decision", async () => {
    const listing = await mkListing(pt, { cancellationPolicy: "non_refundable" });
    const c = await mkUser();
    const { reservation } = await book(c, listing);
    const id = await requestRefund({ customerId: c, reservationId: reservation.id, amountCents: 5000, reason: "Room was not as described (major failure)" });
    const db = await getDb();
    expect(Number((await db.query<any>("select coalesce(sum(refunded_cents),0) s from payments where order_id = $1", [reservation.order_id])).rows[0].s)).toBe(0);
    await decideRefundRequest({ id, approve: true, actor: { id: await mkUser("admin"), role: "admin" } });
    expect(Number((await db.query<any>("select refunded_cents from payments where order_id = $1", [reservation.order_id])).rows[0].refunded_cents)).toBe(5000);
    await expect(decideRefundRequest({ id, approve: true, actor: { id: await mkUser("admin"), role: "admin" } })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
