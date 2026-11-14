import { getDb, inTx } from "@/lib/db";
import { completePastReservations, expireOrder, settleRefund } from "./booking";
import { closeOffer } from "./waitlist";
import { expireBuybacks, finishBuyback } from "./buyback";
import { repriceAuto } from "./pricing";
import { flushNotifications } from "./notifications";
import { transition } from "./inventory";
import { runResaleMaintenance } from "./resale";

export interface MaintenanceSummary {
  expiredOrders: number; expiredOffers: number; expiredBuybacks: number; retriedRefunds: number; resumedBuybacks: number;
  completed: number; repriced: number; resale: { listingsExpired: number; undeliveredRefunded: number; refundsResumed: number; released: number }; closedListings: number; strayHolds: number; notifications: number;
}

/**
 * Background job (every ~20s in-process; or call /api/cron/maintenance from any scheduler).
 * Every step is idempotent and safe to run concurrently with user traffic.
 */
export async function runMaintenance(now = new Date()): Promise<MaintenanceSummary> {
  const db = await getDb();
  const s: MaintenanceSummary = { expiredOrders: 0, expiredOffers: 0, expiredBuybacks: 0, retriedRefunds: 0, resumedBuybacks: 0, completed: 0, repriced: 0, resale: { listingsExpired: 0, undeliveredRefunded: 0, refundsResumed: 0, released: 0 }, closedListings: 0, strayHolds: 0, notifications: 0 };

  // 1. unpaid orders whose hold ran out → inventory released (or passed to the next waitlisted customer)
  for (const o of (await db.query<any>("select id from orders where status = 'pending_payment' and expires_at <= $1", [now])).rows) { await expireOrder(o.id, "hold expired"); s.expiredOrders++; }

  // 2. waitlist offers nobody answered in time → next person in line
  for (const o of (await db.query<any>("select id from waitlist_offers where status = 'pending' and expires_at <= $1", [now])).rows) {
    await inTx(async (tx) => {
      const cur = (await tx.query<any>("select * from waitlist_offers where id = $1 for update", [o.id])).rows[0];
      if (cur.status === "pending") { await closeOffer(tx, cur, "expired"); s.expiredOffers++; }
    });
  }

  // 3. buyback offers the customer ignored → booking returns to normal
  s.expiredBuybacks = await inTx((tx) => expireBuybacks(tx, now));

  // 4. reconcile interrupted money movements (idempotent provider keys make retries safe)
  for (const r of (await db.query<any>("select id from refunds where status = 'pending' and created_at < $1 and kind <> 'buyback'", [new Date(now.getTime() - 30_000)])).rows) { if ((await settleRefund(r.id)).ok) s.retriedRefunds++; }
  for (const b of (await db.query<any>("select id from buyback_offers where status = 'processing'")).rows) { if ((await finishBuyback(b.id)) === "done") s.resumedBuybacks++; }

  // 5. stays / events that have finished
  s.completed = await inTx((tx) => completePastReservations(tx, now));

  // 6. dynamic pricing for auto-priced listings
  s.repriced = await inTx((tx) => repriceAuto(tx, now));

  // 7. housekeeping: close listings past their deadline; free orphaned holds
  s.closedListings = (await db.query("update listings set status = 'closed', updated_at = now() where status = 'published' and booking_deadline <= $1", [now])).rowCount;
  await db.query("update waitlist_entries set status = 'expired', updated_at = now() where status = 'active' and listing_id in (select id from listings where booking_deadline <= $1)", [now]);
  const stray = (await db.query<any>(
    `select u.id from inventory_units u where u.status = 'held' and u.reserved_until < $1
        and not exists (select 1 from reservations r where r.unit_id = u.id and r.status = 'pending_payment')`, [new Date(now.getTime() - 60_000)])).rows;
  for (const u of stray) { await inTx((tx) => transition(tx, u.id, "available", { reason: "orphaned hold swept" })); s.strayHolds++; }

  // 8. peer resale: expire stale listings, refund undelivered sales, auto-release escrow
  s.resale = await runResaleMaintenance(now);

  s.notifications = await flushNotifications();
  return s;
}
