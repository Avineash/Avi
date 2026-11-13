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
