import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { seedDemo } from "@/lib/db/seed";
import { reconcile } from "@/lib/domain/finance";
import { checkEligibility } from "@/lib/domain/buyback";
import { freshDb } from "./helpers";

describe("Melbourne demo seed", () => {
  it("builds a consistent, reconciled marketplace including the $180 / $300 buyback scenario", async () => {
    await freshDb();
    await seedDemo();
    const db = await getDb();
    expect((await reconcile(db)).balanced).toBe(true);
    const n = async (sql: string) => Number((await db.query<any>(sql)).rows[0].n);
    expect(await n("select count(*)::int n from listings where status = 'published'")).toBeGreaterThan(40);
    expect(await n("select count(distinct category)::int n from listings")).toBe(3);
    expect(await n("select count(*)::int n from users where is_demo and role = 'customer'")).toBe(4);
    expect(await n("select count(*)::int n from partners where status = 'pending'")).toBe(1);
    const ex = (await db.query<any>("select r.id, l.current_price_cents from reservations r join listings l on l.id = r.listing_id where l.current_price_cents = 18000 and r.status = 'confirmed' and r.buyback_consent")).rows[0];
    expect(ex).toBeTruthy();
    expect((await checkEligibility(db, ex.id)).eligible).toBe(true);
    // every demo payment is a sandbox payment and is never presented as real
    expect(await n("select count(*)::int n from payments where provider <> 'sandbox'")).toBe(0);
  });
});

import { seedResaleDemo } from "@/lib/db/seed-resale";
import { searchResale } from "@/lib/domain/resale";

describe("Buyer/seller demo seed", () => {
  it("builds registered venues, sellers, listings and purchases in every state, and the books balance", async () => {
    await freshDb();
    await seedResaleDemo();
    const db = await getDb();
    const n = async (sql: string) => Number((await db.query<any>(sql)).rows[0].n);
    expect((await reconcile(db)).balanced).toBe(true);
    expect(await n("select count(*)::int n from resale_listings")).toBeGreaterThanOrEqual(10);
    expect(await n("select count(distinct category)::int n from resale_listings")).toBe(3);
    expect(await n("select count(*)::int n from resale_orders where status = 'paid'")).toBe(2);        // sellers must deliver (incl. the sold-out table)
    expect(await n("select count(*)::int n from resale_orders where status = 'delivered'")).toBe(1);   // buyer must confirm
    expect(await n("select count(*)::int n from resale_orders where status = 'completed'")).toBe(4);
    expect(await n("select count(*)::int n from resale_reviews")).toBe(4);
    expect(await n("select count(*)::int n from payments where provider <> 'sandbox'")).toBe(0);
    // nothing is listed at the unapproved partner's venue, and the venue that bans resale has no listings
    expect(await n("select count(*)::int n from resale_listings l join venues v on v.id = l.venue_id join partners p on p.id = v.partner_id where p.status <> 'approved'")).toBe(0);
    expect(await n("select count(*)::int n from resale_listings l join venues v on v.id = l.venue_id where not v.resale_allowed")).toBe(0);
    const live = await searchResale({});
    expect(live.length).toBeGreaterThanOrEqual(10);
    expect(live.every((l) => l.ask_unit_cents <= Math.floor(l.original_unit_cents * 1.1))).toBe(true);
  });
});
