import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { cancelReservation } from "@/lib/domain/booking";
import { acceptOffer, declineOffer, joinWaitlist, partnerReleaseToWaitlist } from "@/lib/domain/waitlist";
import { runMaintenance } from "@/lib/domain/maintenance";
import { sandboxPay } from "@/lib/domain/booking";
import { book, freshDb, joinList, mkListing, mkPartner, mkUser, unitStatuses } from "./helpers";

beforeAll(async () => { await freshDb(); });

async function soldOut(policy: "first_come" | "highest_offer", o: { offerMinutes?: number } = {}) {
  const pt = await mkPartner({ policy, ...o });
  const listing = await mkListing(pt, { units: 1, priceCents: 20000 });
  const holder = await mkUser();
  const { reservation } = await book(holder, listing);
  return { pt, listing, holder, reservation };
}
const cancel = (r: any, c: string) => cancelReservation({ reservationId: r.id, actor: { id: c, role: "customer" }, mode: "policy", reason: "x", asCustomer: true });
const pendingOffer = async (customerId: string) => (await (await getDb()).query<any>("select * from waitlist_offers where customer_id = $1 and status = 'pending'", [customerId])).rows[0];

describe("waitlist", () => {
  it("can only be joined when sold out, once per listing", async () => {
    const pt = await mkPartner();
    const listing = await mkListing(pt, { units: 1 });
    await expect(joinList(await mkUser(), listing)).rejects.toMatchObject({ code: "INVALID" });
    await book(await mkUser(), listing);
    const c = await mkUser();
    await joinList(c, listing, 25000);
    await expect(joinList(c, listing)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("first_come: the earliest eligible entry gets the freed unit; price cap is respected", async () => {
    const { listing, holder, reservation } = await soldOut("first_come");
    const tooLow = await mkUser(), first = await mkUser(), second = await mkUser();
    await joinList(tooLow, listing, 15000);   // max below the $200 price → never eligible
    await joinList(first, listing, 22000);
    await joinList(second, listing, 90000);
    await cancel(reservation, holder);
    expect(await pendingOffer(tooLow)).toBeUndefined();
    expect((await pendingOffer(first)).price_cents).toBe(20000);
    expect(await pendingOffer(second)).toBeUndefined();
    expect(await unitStatuses(listing)).toEqual(["waitlisted"]);
  });

  it("highest_offer: the highest maximum goes first, ties broken by sign-up time", async () => {
    const { listing, holder, reservation } = await soldOut("highest_offer");
    const a = await mkUser(), b = await mkUser(), c = await mkUser();
    await joinList(a, listing, 25000);
    await joinList(b, listing, 40000);
    await joinList(c, listing, 40000);
    await cancel(reservation, holder);
    expect(await pendingOffer(b)).toBeTruthy();
    expect(await pendingOffer(c)).toBeUndefined();
    expect(await pendingOffer(a)).toBeUndefined();
    expect((await pendingOffer(b)).price_cents).toBe(20000); // pays the listed price, never their maximum
  });

  it("unanswered offers expire and cascade to the next person; with nobody left the unit goes back on sale", async () => {
    const { listing, holder, reservation } = await soldOut("first_come");
    const a = await mkUser(), b = await mkUser();
    await joinList(a, listing); await joinList(b, listing);
    await cancel(reservation, holder);
    const db = await getDb();
    const offerA = await pendingOffer(a);
    await db.query("update waitlist_offers set expires_at = now() - interval '1 second' where id = $1", [offerA.id]);
    await runMaintenance();
    expect((await db.query<any>("select status from waitlist_offers where id = $1", [offerA.id])).rows[0].status).toBe("expired");
    expect(await pendingOffer(b)).toBeTruthy();
    await declineOffer(b, (await pendingOffer(b)).id);
    expect(await unitStatuses(listing)).toEqual(["available"]);
    // A already had this unit offered — they are not offered it again
    expect(await pendingOffer(a)).toBeUndefined();
  });

  it("accepting creates a held order at the offer price; paying books it and fulfils the entry", async () => {
    const { listing, holder, reservation } = await soldOut("first_come");
    const w = await mkUser();
    await joinList(w, listing, 30000);
    await cancel(reservation, holder);
    const offer = await pendingOffer(w);
    const { orderId } = await acceptOffer(w, offer.id);
    expect(await unitStatuses(listing)).toEqual(["held"]);
    await sandboxPay({ orderId, customerId: w, cardNumber: "4242424242424242" });
    expect(await unitStatuses(listing)).toEqual(["booked"]);
    const db = await getDb();
    expect((await db.query<any>("select status from waitlist_entries where customer_id = $1", [w])).rows[0].status).toBe("fulfilled");
    expect((await db.query<any>("select price_cents from reservations where order_id = $1", [orderId])).rows[0].price_cents).toBe(20000);
  });

  it("an accepted offer that is never paid is released to the next person", async () => {
    const { listing, holder, reservation } = await soldOut("first_come");
    const a = await mkUser(), b = await mkUser();
    await joinList(a, listing); await joinList(b, listing);
    await cancel(reservation, holder);
    const { orderId } = await acceptOffer(a, (await pendingOffer(a)).id);
    const db = await getDb();
    await db.query("update orders set expires_at = now() - interval '1 second' where id = $1", [orderId]);
    await runMaintenance();
    expect(await pendingOffer(b)).toBeTruthy();
    expect((await db.query<any>("select status from waitlist_entries where customer_id = $1", [a])).rows[0].status).toBe("expired");
  });

  it("another customer cannot accept someone else's offer", async () => {
    const { listing, holder, reservation } = await soldOut("first_come");
    const w = await mkUser();
    await joinList(w, listing);
    await cancel(reservation, holder);
    await expect(acceptOffer(await mkUser(), (await pendingOffer(w)).id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("simple workflow: new/unsold inventory is released straight to the waitlist (no buyback involved)", async () => {
    const pt = await mkPartner({ policy: "first_come" });
    const listing = await mkListing(pt, { units: 1, priceCents: 20000 });
    await book(await mkUser(), listing);
    const w = await mkUser();
    await joinWaitlist({ customerId: w, listingId: listing, maxPriceCents: 30000 });
    const db = await getDb();
    // partner adds a unit (or gets one back) and chooses to offer it to the waitlist before the public
    const { addUnits } = await import("@/lib/domain/catalog");
    await addUnits(db, listing, pt.partnerId, 1, "Room");
    const fresh = (await db.query<any>("select id from inventory_units where listing_id = $1 and status = 'available'", [listing])).rows[0];
    const actor = { id: pt.ownerId, role: "partner" };
    // a BOOKED unit can never be pulled this way
    const booked = (await db.query<any>("select id from inventory_units where listing_id = $1 and status = 'booked'", [listing])).rows[0];
    await expect(partnerReleaseToWaitlist({ partnerId: pt.partnerId, unitId: booked.id, actor })).rejects.toMatchObject({ code: "CONFLICT" });
    // someone else's inventory can't be released
    const other = await mkPartner();
    await expect(partnerReleaseToWaitlist({ partnerId: other.partnerId, unitId: fresh.id, actor })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const offer = await partnerReleaseToWaitlist({ partnerId: pt.partnerId, unitId: fresh.id, actor });
    expect(offer?.customer_id).toBe(w);
    expect(offer?.source).toBe("release");
    expect(await unitStatuses(listing)).toEqual(["booked", "waitlisted"]);
  });
});
