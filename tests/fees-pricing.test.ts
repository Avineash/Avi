import { beforeAll, describe, expect, it } from "vitest";
import { getDb, inTx } from "@/lib/db";
import { computeFee, gstOf, resolveFeeRule } from "@/lib/domain/fees";
import { repriceAuto, setManualPrice, suggestPrice } from "@/lib/domain/pricing";
import { isValidAbn } from "@/lib/domain/partners";
import { refundBps } from "@/lib/domain/policies";
import { allocate, hours } from "@/lib/util";
import { book, freshDb, mkListing, mkPartner, mkUser } from "./helpers";

beforeAll(async () => { await freshDb(); });

describe("commission engine (nothing hard-coded)", () => {
  it("resolves partner > category > global from the database", async () => {
    const db = await getDb();
    const hotel = await mkPartner({ category: "hotel" });
    const rest = await mkPartner({ category: "restaurant" });
    expect((await resolveFeeRule(db, { payer: "partner", flow: "booking", category: "hotel", partnerId: hotel.partnerId })).scope).toBe("category");
    const r = await resolveFeeRule(db, { payer: "partner", flow: "booking", category: "restaurant", partnerId: rest.partnerId });
    expect(r.kind).toBe("percent_plus_fixed");
    await db.query("insert into fee_rules(payer, applies_to, scope, partner_id, kind, rate_bps) values ('partner','booking','partner',$1,'percentage',900)", [hotel.partnerId]);
    const o = await resolveFeeRule(db, { payer: "partner", flow: "booking", category: "hotel", partnerId: hotel.partnerId });
    expect(o.scope).toBe("partner");
    expect(computeFee(o, 20000)).toBe(1800);
  });

  it("changing a rule changes what the next booking pays, without a code change", async () => {
    const db = await getDb();
    const pt = await mkPartner({ category: "hotel" });
    await db.query("insert into fee_rules(payer, applies_to, scope, partner_id, kind, rate_bps) values ('partner','booking','partner',$1,'percentage',2000)", [pt.partnerId]);
    const listing = await mkListing(pt, { priceCents: 10000, minCents: 5000 });
    const { reservation } = await book(await mkUser(), listing);
    const c = (await db.query<any>("select amount_cents from platform_fees where reservation_id = $1 and kind = 'commission'", [reservation.id])).rows[0];
    expect(c.amount_cents).toBe(2000);
  });

  it("computes percentage / fixed / mixed with min and max clamps", () => {
    expect(computeFee({ kind: "percentage", rate_bps: 400, fixed_cents: 0, min_cents: 200, max_cents: 1500 }, 1000)).toBe(200);
    expect(computeFee({ kind: "percentage", rate_bps: 400, fixed_cents: 0, min_cents: 200, max_cents: 1500 }, 100000)).toBe(1500);
    expect(computeFee({ kind: "fixed", rate_bps: 0, fixed_cents: 300, min_cents: 0, max_cents: null }, 99999)).toBe(300);
    expect(computeFee({ kind: "percent_plus_fixed", rate_bps: 500, fixed_cents: 200, min_cents: 0, max_cents: null }, 10000)).toBe(700);
  });

  it("fails closed when no rule exists", async () => {
    const db = await getDb();
    const pt = await mkPartner();
    await db.query("update fee_rules set active = false where payer = 'partner' and applies_to = 'resale'");
    await expect(resolveFeeRule(db, { payer: "partner", flow: "resale", category: "event", partnerId: pt.partnerId })).rejects.toMatchObject({ code: "CONFIG" });
  });

  it("GST is 1/11 of GST-inclusive amounts; allocation never loses a cent", () => {
    expect(gstOf(11000)).toBe(1000);
    const parts = allocate(1001, [3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
  });

  it("validates ABNs with the ATO checksum", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true);
    expect(isValidAbn("51 824 753 557")).toBe(false);
    expect(isValidAbn("123")).toBe(false);
  });
});

describe("cancellation policy terms", () => {
  it("maps hours-before-start to refund fractions", () => {
    expect(refundBps("flexible", 5)).toBe(10000);
    expect(refundBps("flexible", 3)).toBe(0);
    expect(refundBps("moderate", 30)).toBe(10000);
    expect(refundBps("moderate", 10)).toBe(5000);
    expect(refundBps("moderate", 2)).toBe(0);
    expect(refundBps("strict", 48)).toBe(5000);
    expect(refundBps("non_refundable", 500)).toBe(0);
  });
});

describe("dynamic pricing (rule-based)", () => {
  it("discounts close to start, respects min/max, and explains every adjustment", async () => {
    const db = await getDb();
    const pt = await mkPartner();
    const soon = await mkListing(pt, { units: 4, originalCents: 30000, minCents: 20000, maxCents: 40000, priceCents: 30000, startsAt: new Date(Date.now() + hours(2)), endsAt: new Date(Date.now() + hours(26)), bookingDeadline: new Date(Date.now() + hours(1)) });
    const s = await suggestPrice(db, soon);
    expect(s.adjustments.map((a) => a.rule)).toContain("time_decay");
    expect(s.suggestedCents).toBeGreaterThanOrEqual(20000);
    expect(s.suggestedCents).toBeLessThanOrEqual(40000);
    const floor = await mkListing(pt, { units: 4, originalCents: 30000, minCents: 29000, maxCents: 40000, priceCents: 30000, startsAt: new Date(Date.now() + hours(2)), endsAt: new Date(Date.now() + hours(26)), bookingDeadline: new Date(Date.now() + hours(1)) });
    const f = await suggestPrice(db, floor);
    expect(f.suggestedCents).toBe(29000);
    expect(f.clampedBy).toBe("min");
  });

  it("waitlist demand and scarcity push the price up", async () => {
    const db = await getDb();
    const pt = await mkPartner();
    const listing = await mkListing(pt, { units: 1, originalCents: 30000, minCents: 10000, maxCents: 60000, priceCents: 30000, startsAt: new Date(Date.now() + hours(100)), endsAt: new Date(Date.now() + hours(124)), bookingDeadline: new Date(Date.now() + hours(99)) });
    const before = await suggestPrice(db, listing);
    await book(await mkUser(), listing);
    const { joinWaitlist } = await import("@/lib/domain/waitlist");
    await joinWaitlist({ customerId: await mkUser(), listingId: listing }); await joinWaitlist({ customerId: await mkUser(), listingId: listing });
    const after = await suggestPrice(db, listing);
    expect(after.adjustments.map((a) => a.rule)).toEqual(expect.arrayContaining(["demand", "scarcity"]));
    expect(after.multiplier).toBeGreaterThan(before.multiplier);
  });

  it("partners can always override: manual price must be inside their own bounds; auto mode re-prices; manual stops it", async () => {
    const db = await getDb();
    const pt = await mkPartner();
    const listing = await mkListing(pt, { units: 3, originalCents: 30000, minCents: 15000, maxCents: 35000, priceCents: 30000, pricingMode: "auto", startsAt: new Date(Date.now() + hours(2)), endsAt: new Date(Date.now() + hours(26)), bookingDeadline: new Date(Date.now() + hours(1)) });
    expect(await inTx((tx) => repriceAuto(tx))).toBeGreaterThanOrEqual(1);
    const p = (await db.query<any>("select current_price_cents from listings where id = $1", [listing])).rows[0].current_price_cents;
    expect(p).toBeLessThan(30000);
    await expect(setManualPrice(db, listing, 99999)).rejects.toMatchObject({ code: "INVALID" });
    await setManualPrice(db, listing, 28000);
    expect(await inTx((tx) => repriceAuto(tx))).toBe(0); // manual mode is left alone
    expect((await db.query<any>("select current_price_cents, pricing_mode from listings where id = $1", [listing])).rows[0]).toMatchObject({ current_price_cents: 28000, pricing_mode: "manual" });
  });
});
