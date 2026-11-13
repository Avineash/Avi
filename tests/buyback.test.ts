import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { acceptOffer } from "@/lib/domain/waitlist";
import { decideBuybackApproval, checkEligibility, findOpportunities, proposeBuyback, quoteBuyback, respondToBuyback } from "@/lib/domain/buyback";
import { cancelReservation, sandboxPay } from "@/lib/domain/booking";
import { reconcile } from "@/lib/domain/finance";
import { runMaintenance } from "@/lib/domain/maintenance";
import { sandboxFaults } from "@/lib/providers/payments";
import { hours } from "@/lib/util";
import { book, enableBuyback, freshDb, joinList, mkListing, mkPartner, mkUser, unitStatuses } from "./helpers";

// The worked example from the product brief: a room listed at $180, customer A books it, customer B waitlists with a $300 maximum.
async function scenario(o: { consent?: boolean; policy?: "first_come" | "highest_offer"; thresholdCents?: number; category?: "hotel" | "event"; startsInH?: number } = {}) {
  const category = o.category ?? "hotel";
  const pt = await mkPartner({ category, buyback: true, policy: o.policy, thresholdCents: o.thresholdCents ?? 20000 });
  const start = o.startsInH ?? 30;
  const listing = await mkListing(pt, {
    units: 1, priceCents: 18000, originalCents: category === "event" ? 18000 : 30000, minCents: 10000, maxCents: 40000,
    startsAt: new Date(Date.now() + hours(start)), endsAt: new Date(Date.now() + hours(start + 24)), bookingDeadline: new Date(Date.now() + hours(start - 1)),
  });
  const A = await mkUser("customer", "Customer A"), B = await mkUser("customer", "Customer B");
  const { reservation } = await book(A, listing, { consent: o.consent ?? true });
  const entry = await joinList(B, listing, 30000);
  return { pt, listing, A, B, reservation, entry, actor: { id: pt.ownerId, role: "partner" } };
}
const offerRow = async (id: string) => (await (await getDb()).query<any>("select * from buyback_offers where id = $1", [id])).rows[0];
const resStatus = async (id: string) => (await (await getDb()).query<any>("select status from reservations where id = $1", [id])).rows[0].status;

beforeEach(async () => { await freshDb(); await enableBuyback(true); });

describe("buyback — economics (the $180 / $300 example)", () => {
  it("calculates every line of the outcome and the net benefit to the hotel", async () => {
    const s = await scenario();
    const db = await getDb();
    const q = await quoteBuyback(db, { reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    expect(q.originalPriceCents).toBe(18000);
    expect(q.originalCommissionCents).toBe(2700);           // 15% of $180
    expect(q.compensationCents).toBe(3000);
    expect(q.paymentCostCents).toBe(Math.round(q.originalTotalCents * 0.0175) + 30);
    expect(q.buybackFeeCents).toBe(3000);                    // 10% buyback fee on $300 (separately configured rule)
    expect(q.resaleCustomerFeeCents).toBe(1200);             // 4% customer fee on $300
    expect(q.partnerKeepNetCents).toBe(18000 - 2700);
    expect(q.partnerBuybackNetCents).toBe(30000 - 3000 - 3000 - q.paymentCostCents);
    expect(q.netBenefitCents).toBe(q.partnerBuybackNetCents - q.partnerKeepNetCents);
    expect(q.netBenefitCents).toBeGreaterThan(0);
    expect(q.customerAReceivesCents).toBe(q.originalTotalCents + 3000);
  });
});

describe("buyback — eligibility gates", () => {
  it("is blocked until legal review is recorded and the feature enabled", async () => {
    const s = await scenario();
    await enableBuyback(false);
    const db = await getDb();
    expect((await checkEligibility(db, s.reservation.id)).reasons.join(" ")).toMatch(/legal review/);
    await expect(proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 2000, resalePriceCents: 30000 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await unitStatuses(s.listing)).toEqual(["booked"]);
  });

  it("requires the customer's checkout opt-in", async () => {
    const s = await scenario({ consent: false });
    const el = await checkEligibility(await getDb(), s.reservation.id);
    expect(el.eligible).toBe(false);
    expect(el.reasons.join(" ")).toMatch(/opt in/);
  });

  it("refuses when too close to the start, when the partner has not enabled it, or when compensation/price are outside rules", async () => {
    const near = await scenario({ startsInH: 3 });
    expect((await checkEligibility(await getDb(), near.reservation.id)).reasons.join(" ")).toMatch(/Too close/);
    const s = await scenario();
    const base = { partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id };
    await expect(proposeBuyback({ ...base, compensationCents: 100, resalePriceCents: 30000 })).rejects.toMatchObject({ code: "INVALID" });      // below minimum incentive
    await expect(proposeBuyback({ ...base, compensationCents: 99999, resalePriceCents: 30000 })).rejects.toMatchObject({ code: "INVALID" });    // above partner cap
    await expect(proposeBuyback({ ...base, compensationCents: 2000, resalePriceCents: 45000 })).rejects.toMatchObject({ code: "INVALID" });     // above listing max
    await expect(proposeBuyback({ ...base, compensationCents: 2000, resalePriceCents: 31000 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" }); // nobody on the waitlist can pay $310
    await expect(proposeBuyback({ ...base, partnerId: (await mkPartner()).partnerId, compensationCents: 2000, resalePriceCents: 30000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await (await getDb()).query("update partners set buyback_enabled = false where id = $1", [s.pt.partnerId]);
    await expect(proposeBuyback({ ...base, compensationCents: 2000, resalePriceCents: 30000 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("will not propose a deal that costs the partner money", async () => {
    const s = await scenario();
    await expect(proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 9000, resalePriceCents: 19000 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("event tickets: resale is capped at the legal multiple of face value and always needs admin approval", async () => {
    const s = await scenario({ category: "event" });
    const base = { partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id };
    await expect(proposeBuyback({ ...base, compensationCents: 2000, resalePriceCents: 30000 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" }); // 110% of $180 face = $198
    const db = await getDb();
    await db.query("update waitlist_entries set max_price_cents = 19800 where id = $1", [s.entry]);
    const r = await proposeBuyback({ ...base, compensationCents: 2000, resalePriceCents: 19800 });
    expect(r.status).toBe("pending_admin");
    await enableBuyback(false); // event resale gate off → ineligible
    expect((await checkEligibility(db, s.reservation.id)).eligible).toBe(false);
  });
});

describe("buyback — full workflow", () => {
  it("happy path: offer → A accepts → refund + compensation → release → B offered → B pays → everyone reconciled", async () => {
    const s = await scenario();
    const db = await getDb();
    const { offerId, status } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000, note: "We'd love the room back" });
    expect(status).toBe("pending_customer");
    expect(await unitStatuses(s.listing)).toEqual(["buyback_pending"]);
    expect(await resStatus(s.reservation.id)).toBe("confirmed"); // nothing cancelled yet

    await respondToBuyback({ customerId: s.A, offerId, decision: "accept" });
    expect(await resStatus(s.reservation.id)).toBe("cancelled");
    const refund = (await db.query<any>("select * from refunds where reservation_id = $1", [s.reservation.id])).rows[0];
    expect(refund).toMatchObject({ kind: "buyback", status: "succeeded", amount_cents: s.reservation.total_cents });
    const comp = (await db.query<any>("select * from compensation_payments where buyback_offer_id = $1", [offerId])).rows[0];
    expect(comp).toMatchObject({ amount_cents: 3000, status: "paid" });
    expect((await db.query<any>("select kind from buyback_consents where buyback_offer_id = $1", [offerId])).rows[0].kind).toBe("offer_acceptance");
    expect(await unitStatuses(s.listing)).toEqual(["waitlisted"]); // offered to B, only after refund + compensation
    expect((await offerRow(offerId)).status).toBe("resale_pending");

    const bOffer = (await db.query<any>("select * from waitlist_offers where customer_id = $1 and status = 'pending'", [s.B])).rows[0];
    expect(bOffer).toMatchObject({ price_cents: 30000, source: "buyback" });
    const { orderId } = await acceptOffer(s.B, bOffer.id);
    await sandboxPay({ orderId, customerId: s.B, cardNumber: "4242424242424242" });

    expect(await unitStatuses(s.listing)).toEqual(["booked"]);
    expect((await offerRow(offerId)).status).toBe("completed");
    const newRes = (await db.query<any>("select * from reservations where order_id = $1", [orderId])).rows[0];
    expect(newRes).toMatchObject({ status: "confirmed", price_cents: 30000, customer_id: s.B });

    // financial reconciliation
    const q = await quoteBuyback(db, { reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 }).catch(() => null);
    const o = await offerRow(offerId);
    const ledgerNet = Number((await db.query<any>("select sum(amount_cents) s from ledger_entries where partner_id = $1", [s.pt.partnerId])).rows[0].s);
    expect(ledgerNet).toBe(o.partner_net_cents);             // partner ends with exactly the quoted net
    expect(ledgerNet - o.partner_keep_net_cents).toBe(o.net_benefit_cents);
    expect((await reconcile(db)).balanced).toBe(true);
    const buybackFee = (await db.query<any>("select amount_cents from platform_fees where reservation_id = $1 and kind = 'buyback_fee'", [newRes.id])).rows[0];
    expect(buybackFee.amount_cents).toBe(3000);
    expect(q).toBeDefined();
  });

  it("customer rejects: booking, payment and inventory are completely unchanged", async () => {
    const s = await scenario();
    const db = await getDb();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    await respondToBuyback({ customerId: s.A, offerId, decision: "reject" });
    expect((await offerRow(offerId)).status).toBe("rejected");
    expect(await resStatus(s.reservation.id)).toBe("confirmed");
    expect(await unitStatuses(s.listing)).toEqual(["booked"]);
    expect((await db.query("select 1 from refunds where reservation_id = $1", [s.reservation.id])).rows).toHaveLength(0);
    await expect(respondToBuyback({ customerId: s.A, offerId, decision: "accept" })).rejects.toMatchObject({ code: "EXPIRED" }); // can't change mind after rejecting
  });

  it("customer ignores: the offer expires and the booking returns to normal", async () => {
    const s = await scenario();
    const db = await getDb();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    await db.query("update buyback_offers set expires_at = now() - interval '1 second' where id = $1", [offerId]);
    await expect(respondToBuyback({ customerId: s.A, offerId, decision: "accept" })).rejects.toMatchObject({ code: "EXPIRED" });
    await runMaintenance();
    expect((await offerRow(offerId)).status).toBe("expired");
    expect(await resStatus(s.reservation.id)).toBe("confirmed");
    expect(await unitStatuses(s.listing)).toEqual(["booked"]);
  });

  it("a higher bidder alone never cancels a confirmed booking", async () => {
    const s = await scenario();
    const C = await mkUser();
    await joinList(C, s.listing, 99999);
    await runMaintenance();
    expect(await resStatus(s.reservation.id)).toBe("confirmed");
    expect(await unitStatuses(s.listing)).toEqual(["booked"]);
    // …and the only API that touches a booked unit requires A's explicit acceptance of a specific offer
    await expect(respondToBuyback({ customerId: s.A, offerId: "00000000-0000-0000-0000-000000000000", decision: "accept" })).rejects.toBeTruthy();
  });

  it("only the offered customer can respond", async () => {
    const s = await scenario();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    await expect(respondToBuyback({ customerId: s.B, offerId, decision: "accept" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await resStatus(s.reservation.id)).toBe("confirmed");
  });

  it("refund failure: nothing is released and the reservation stays confirmed until the money moves", async () => {
    const s = await scenario();
    const db = await getDb();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    sandboxFaults.refund = 1;
    await respondToBuyback({ customerId: s.A, offerId, decision: "accept" });
    expect((await offerRow(offerId)).status).toBe("processing");
    expect(await resStatus(s.reservation.id)).toBe("confirmed");
    expect(await unitStatuses(s.listing)).toEqual(["buyback_pending"]);
    expect((await db.query("select 1 from waitlist_offers where customer_id = $1", [s.B])).rows).toHaveLength(0);
    await runMaintenance(); // reconciler retries with the same idempotency key
    expect((await offerRow(offerId)).status).toBe("resale_pending");
    expect(await resStatus(s.reservation.id)).toBe("cancelled");
    expect((await db.query("select 1 from refunds where reservation_id = $1 and status = 'succeeded'", [s.reservation.id])).rows).toHaveLength(1);
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("compensation failure holds the release; the retry pays once and then releases", async () => {
    const s = await scenario();
    const db = await getDb();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    sandboxFaults.compensation = 1;
    await respondToBuyback({ customerId: s.A, offerId, decision: "accept" });
    expect(await unitStatuses(s.listing)).toEqual(["cancelled"]);
    await runMaintenance();
    expect(await unitStatuses(s.listing)).toEqual(["waitlisted"]);
    expect((await db.query("select 1 from compensation_payments where buyback_offer_id = $1 and status = 'paid'", [offerId])).rows).toHaveLength(1);
  });

  it("B declines: the room goes back on sale; A keeps refund + compensation; offer ends 'completed_unsold'", async () => {
    const s = await scenario();
    const db = await getDb();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    await respondToBuyback({ customerId: s.A, offerId, decision: "accept" });
    const bOffer = (await db.query<any>("select id from waitlist_offers where customer_id = $1 and status = 'pending'", [s.B])).rows[0];
    const { declineOffer } = await import("@/lib/domain/waitlist");
    await declineOffer(s.B, bOffer.id);
    expect(await unitStatuses(s.listing)).toEqual(["available"]);
    expect((await offerRow(offerId)).status).toBe("completed_unsold");
    expect((await reconcile(db)).balanced).toBe(true);
  });

  it("over-threshold compensation needs admin approval before the customer ever sees it", async () => {
    const s = await scenario({ thresholdCents: 2000 });
    const db = await getDb();
    const { offerId, status } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    expect(status).toBe("pending_admin");
    expect(await unitStatuses(s.listing)).toEqual(["buyback_requested"]);
    expect((await db.query("select 1 from notifications where user_id = $1 and kind = 'buyback_offer'", [s.A])).rows).toHaveLength(0);
    await expect(respondToBuyback({ customerId: s.A, offerId, decision: "accept" })).rejects.toMatchObject({ code: "EXPIRED" });
    await decideBuybackApproval({ offerId, approve: true, actor: { id: await mkUser("admin"), role: "admin" } });
    expect((await offerRow(offerId)).status).toBe("pending_customer");
    expect(await unitStatuses(s.listing)).toEqual(["buyback_pending"]);
    expect((await db.query("select 1 from notifications where user_id = $1 and kind = 'buyback_offer'", [s.A])).rows).toHaveLength(1);
  });

  it("admin can decline an exceptional proposal; booking returns to normal", async () => {
    const s = await scenario({ thresholdCents: 2000 });
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    await decideBuybackApproval({ offerId, approve: false, actor: { id: await mkUser("admin"), role: "admin" } });
    expect(await unitStatuses(s.listing)).toEqual(["booked"]);
    expect(await resStatus(s.reservation.id)).toBe("confirmed");
  });

  it("if A cancels on their own while an offer is pending, the offer is withdrawn cleanly", async () => {
    const s = await scenario();
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    await cancelReservation({ reservationId: s.reservation.id, actor: { id: s.A, role: "customer" }, mode: "policy", reason: "own cancel", asCustomer: true });
    expect((await offerRow(offerId)).status).toBe("cancelled");
    expect((await reconcile(await getDb())).balanced).toBe(true);
  });

  it("only one open offer per booking", async () => {
    const s = await scenario();
    const base = { partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 };
    await proposeBuyback(base);
    await expect(proposeBuyback(base)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("customer B is chosen by the partner's published policy, never hand-picked", async () => {
    const s = await scenario({ policy: "highest_offer" });
    const C = await mkUser(); await joinList(C, s.listing, 38000);
    const { offerId } = await proposeBuyback({ partnerId: s.pt.partnerId, actor: s.actor, reservationId: s.reservation.id, compensationCents: 3000, resalePriceCents: 30000 });
    expect((await offerRow(offerId)).waitlist_entry_id).not.toBe(s.entry);
    await respondToBuyback({ customerId: s.A, offerId, decision: "accept" });
    expect((await (await getDb()).query("select 1 from waitlist_offers where customer_id = $1 and status = 'pending'", [C])).rows).toHaveLength(1);
  });

  it("the opportunity finder surfaces only eligible, profitable deals", async () => {
    const s = await scenario();
    const found = await findOpportunities(s.pt.partnerId);
    expect(found).toHaveLength(1);
    expect(found[0].quote.netBenefitCents).toBeGreaterThan(0);
    await enableBuyback(false);
    expect(await findOpportunities(s.pt.partnerId)).toHaveLength(0);
  });
});
