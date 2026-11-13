import type { Queryable } from "@/lib/db";
import { reconcile } from "./finance";

const N = (v: unknown) => Number(v ?? 0);

export async function customerStats(c: Queryable, userId: string) {
  const r = (await c.query<any>(
    `select
       count(*) filter (where r.status = 'confirmed' and l.starts_at > now())::int as upcoming,
       count(*) filter (where r.status in ('confirmed','completed'))::int as total_bookings,
       coalesce(sum(greatest(l.original_price_cents - r.price_cents, 0)) filter (where r.status in ('confirmed','completed')),0)::bigint as savings,
       coalesce(sum(r.total_cents) filter (where r.status in ('confirmed','completed')),0)::bigint as spent
     from reservations r join listings l on l.id = r.listing_id where r.customer_id = $1`, [userId])).rows[0];
  const w = (await c.query<any>("select count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'offered')::int as offered from waitlist_entries where customer_id = $1", [userId])).rows[0];
  const o = (await c.query<any>(
    `select (select count(*)::int from waitlist_offers where customer_id = $1 and status = 'pending' and expires_at > now())
          + (select count(*)::int from buyback_offers where customer_id = $1 and status = 'pending_customer' and expires_at > now()) as n`, [userId])).rows[0];
  return { upcoming: r.upcoming, totalBookings: r.total_bookings, savings: N(r.savings), spent: N(r.spent), waitlistActive: w.active, waitlistOffered: w.offered, openOffers: o.n };
}

export async function partnerStats(c: Queryable, partnerId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const k = (await c.query<any>(
    `select count(*) filter (where r.status in ('confirmed','completed'))::int as bookings,
            coalesce(sum(r.price_cents) filter (where r.status in ('confirmed','completed')),0)::bigint as revenue,
            coalesce(avg(r.price_cents) filter (where r.status in ('confirmed','completed')),0)::float as avg_price,
            count(*)::int as all_res, count(*) filter (where r.status = 'cancelled')::int as cancelled
       from reservations r where r.partner_id = $1 and r.created_at >= $2`, [partnerId, since])).rows[0];
  const refunds = (await c.query<any>(
    "select coalesce(sum(f.amount_cents),0)::bigint s, count(*)::int n from refunds f join reservations r on r.id = f.reservation_id where r.partner_id = $1 and f.status = 'succeeded' and f.created_at >= $2", [partnerId, since])).rows[0];
  const commission = N((await c.query<any>(
    "select coalesce(sum(amount_cents),0)::bigint s from platform_fees where partner_id = $1 and kind in ('commission','buyback_fee','resale_fee') and created_at >= $2", [partnerId, since])).rows[0].s);
  const net = N((await c.query<any>("select coalesce(sum(amount_cents),0)::bigint s from ledger_entries where partner_id = $1 and created_at >= $2", [partnerId, since])).rows[0].s);
  const util = (await c.query<any>(
    `select count(u.*)::int as total, count(*) filter (where u.status in ('booked','completed','buyback_requested','buyback_pending'))::int as sold
       from inventory_units u join listings l on l.id = u.listing_id where u.partner_id = $1 and l.status <> 'draft' and l.starts_at >= $2`, [partnerId, since])).rows[0];
  const wl = (await c.query<any>("select count(*)::int as n, count(distinct w.listing_id)::int as listings from waitlist_entries w join listings l on l.id = w.listing_id where l.partner_id = $1 and w.status = 'active'", [partnerId])).rows[0];
  const b = (await c.query<any>(
    `select count(*)::int as total, count(*) filter (where status in ('processing','resale_pending','completed','completed_unsold'))::int as accepted,
            count(*) filter (where status in ('rejected','expired'))::int as declined, coalesce(sum(net_benefit_cents) filter (where status = 'completed'),0)::bigint as benefit
       from buyback_offers where partner_id = $1 and created_at >= $2`, [partnerId, since])).rows[0];
  const series = (await c.query<any>(
    `select to_char((r.created_at at time zone 'Australia/Melbourne')::date, 'YYYY-MM-DD') as day, count(*)::int as bookings, coalesce(sum(r.price_cents),0)::bigint as revenue
       from reservations r where r.partner_id = $1 and r.status in ('confirmed','completed') and r.created_at >= $2 group by 1 order by 1`, [partnerId, since])).rows;
  return {
    days, bookings: k.bookings, revenue: N(k.revenue), avgPrice: Math.round(k.avg_price), commission, netEarnings: net,
    utilisation: util.total ? util.sold / util.total : 0, unitsTotal: util.total, unitsSold: util.sold,
    waitlistDemand: wl.n, waitlistListings: wl.listings,
    buybackTotal: b.total, buybackAcceptRate: b.total ? b.accepted / b.total : 0, buybackBenefit: N(b.benefit),
    cancellationRate: k.all_res ? k.cancelled / k.all_res : 0, refundRate: k.bookings ? refunds.n / (k.bookings || 1) : 0, refundedCents: N(refunds.s),
    series: series.map((s) => ({ day: s.day, bookings: s.bookings, revenue: N(s.revenue) })),
  };
}

export async function adminStats(c: Queryable, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const g = (await c.query<any>(
    `select coalesce(sum(r.price_cents + r.customer_fee_cents) filter (where r.status in ('confirmed','completed')),0)::bigint as gbv,
            count(*) filter (where r.status in ('confirmed','completed'))::int as bookings,
            coalesce(sum(r.total_cents) filter (where r.status = 'confirmed'),0)::bigint as open_exposure
       from reservations r where r.created_at >= $1`, [since])).rows[0];
  const rev = N((await c.query<any>("select coalesce(sum(amount_cents),0)::bigint s from platform_fees where created_at >= $1", [since])).rows[0].s);
  const partners = (await c.query<any>("select count(*) filter (where status = 'approved')::int as active, count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'suspended')::int as suspended from partners")).rows[0];
  const exposure = (await c.query<any>(
    `select (select coalesce(sum(amount_cents),0) from refunds where status = 'pending')::bigint as pending_refunds,
            (select coalesce(sum(amount_cents),0) from disputes where status in ('open','investigating'))::bigint as open_disputes,
            (select coalesce(sum(amount_cents),0) from refund_requests where status = 'pending')::bigint as requested`)).rows[0];
  const inv = (await c.query<any>("select coalesce(sum(total_units),0)::int t, coalesce(sum(available_units),0)::int a, coalesce(sum(booked_units),0)::int b from listing_availability a join listings l on l.id = a.listing_id where l.status = 'published'")).rows[0];
  const byCat = (await c.query<any>(
    `select l.category, count(*)::int as bookings, coalesce(sum(r.price_cents),0)::bigint as gbv from reservations r join listings l on l.id = r.listing_id
      where r.status in ('confirmed','completed') and r.created_at >= $1 group by 1 order by 1`, [since])).rows;
  const bb = (await c.query<any>("select count(*)::int as total, count(*) filter (where status = 'pending_admin')::int as awaiting, count(*) filter (where status in ('completed','resale_pending','processing','completed_unsold'))::int as accepted from buyback_offers")).rows[0];
  const wl = (await c.query<any>("select count(*)::int n from waitlist_entries where status in ('active','offered')")).rows[0].n;
  const series = (await c.query<any>(
    `select to_char((r.created_at at time zone 'Australia/Melbourne')::date, 'YYYY-MM-DD') as day, count(*)::int as bookings, coalesce(sum(r.price_cents + r.customer_fee_cents),0)::bigint as gbv
       from reservations r where r.status in ('confirmed','completed') and r.created_at >= $1 group by 1 order by 1`, [since])).rows;
  return {
    days, gbv: N(g.gbv), bookings: g.bookings, platformRevenue: rev, openExposure: N(g.open_exposure),
    activePartners: partners.active, pendingPartners: partners.pending, suspendedPartners: partners.suspended,
    refundExposure: N(exposure.pending_refunds) + N(exposure.open_disputes) + N(exposure.requested), exposureBreakdown: { pendingRefunds: N(exposure.pending_refunds), openDisputes: N(exposure.open_disputes), refundRequests: N(exposure.requested) },
    fillRate: inv.t ? 1 - inv.a / inv.t : 0, unitsTotal: inv.t, unitsAvailable: inv.a, waitlistDemand: wl,
    byCategory: byCat.map((r) => ({ category: r.category, bookings: r.bookings, gbv: N(r.gbv) })),
    buyback: bb, series: series.map((s) => ({ day: s.day, bookings: s.bookings, gbv: N(s.gbv) })),
    reconciliation: await reconcile(c),
  };
}

/** Operational alerts derived from live data (stuck money, failing integrations, backlog). */
export async function operationalAlerts(c: Queryable) {
  const alerts: Array<{ level: "warn" | "error" | "info"; message: string; href?: string }> = [];
  const n = async (sql: string) => N((await c.query<any>(sql)).rows[0].n);
  const stuckRefunds = await n("select count(*)::int n from refunds where status = 'pending' and created_at < now() - interval '2 minutes'");
  if (stuckRefunds) alerts.push({ level: "error", message: `${stuckRefunds} refund(s) pending for more than 2 minutes`, href: "/admin/transactions" });
  const comp = await n("select count(*)::int n from compensation_payments where status = 'pending' and provider_ref is not null");
  if (comp) alerts.push({ level: "warn", message: `${comp} buyback compensation payment(s) need manual disbursement`, href: "/admin/buybacks" });
  const pend = await n("select count(*)::int n from partners where status = 'pending'");
  if (pend) alerts.push({ level: "info", message: `${pend} partner application(s) awaiting verification`, href: "/admin/partners" });
  const bb = await n("select count(*)::int n from buyback_offers where status = 'pending_admin'");
  if (bb) alerts.push({ level: "warn", message: `${bb} buyback proposal(s) awaiting approval`, href: "/admin/buybacks" });
  const rr = await n("select count(*)::int n from refund_requests where status = 'pending'");
  if (rr) alerts.push({ level: "warn", message: `${rr} exceptional refund request(s) awaiting decision`, href: "/admin/disputes" });
  const dp = await n("select count(*)::int n from disputes where status in ('open','investigating')");
  if (dp) alerts.push({ level: "warn", message: `${dp} open dispute(s)`, href: "/admin/disputes" });
  const fails = await n("select count(*)::int n from partner_payouts where status = 'failed'");
  if (fails) alerts.push({ level: "error", message: `${fails} partner payout(s) failed`, href: "/admin/transactions" });
  const ie = await n("select count(*)::int n from integration_events where level = 'error' and created_at > now() - interval '24 hours'");
  if (ie) alerts.push({ level: "error", message: `${ie} integration error(s) in the last 24h`, href: "/admin/system" });
  const rec = await reconcile(c);
  if (!rec.balanced) alerts.push({ level: "error", message: `Ledger does not reconcile: off by ${rec.difference} cents`, href: "/admin/reports" });
  return alerts;
}
