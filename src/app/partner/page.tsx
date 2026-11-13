import type { Metadata } from "next";
import Link from "next/link";
import { BarChart, Stat, moneyLabel, pct } from "@/components/charts";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { partnerStats } from "@/lib/domain/analytics";
import { findOpportunities } from "@/lib/domain/buyback";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "Partner dashboard" };

export default async function PartnerHome() {
  const u = await requirePermission("partner:portal", "/partner");
  if (!u.partnerId) return <EmptyState title="No partner profile" />;
  const db = await getDb();
  const s = await partnerStats(db, u.partnerId, 30);
  const opps = u.partnerStatus === "approved" ? await findOpportunities(u.partnerId) : [];
  const soon = (await db.query<any>(
    `select r.reference, r.guest_name, r.guests, r.status, l.title, l.starts_at from reservations r join listings l on l.id = r.listing_id
      where r.partner_id = $1 and r.status = 'confirmed' and l.starts_at between now() and now() + interval '48 hours' order by l.starts_at limit 6`, [u.partnerId])).rows;
  const low = (await db.query<any>(
    `select l.id, l.title, a.available_units, a.total_units, l.starts_at from listings l join listing_availability a on a.listing_id = l.id
      where l.partner_id = $1 and l.status = 'published' and l.starts_at > now() and a.available_units <= 1 order by l.starts_at limit 5`, [u.partnerId])).rows;
  return (
    <>
      <PageHeader title="Dashboard" eyebrow="Last 30 days" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={aud(s.revenue, { whole: true })} hint={`${s.bookings} bookings`} />
        <Stat label="Net earnings" value={aud(s.netEarnings, { whole: true })} hint={`after ${aud(s.commission, { whole: true })} commission`} tone="gold" />
        <Stat label="Utilisation" value={pct(s.utilisation)} hint={`${s.unitsSold} of ${s.unitsTotal} units`} />
        <Stat label="Waitlist demand" value={s.waitlistDemand} hint={`across ${s.waitlistListings} listings`} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card><CardHeader><CardTitle>Revenue by day</CardTitle></CardHeader><CardBody><BarChart title="Revenue by day" data={s.series.map((d) => ({ label: d.day, value: d.revenue }))} valueLabel={moneyLabel} /></CardBody></Card>
        <Card><CardHeader><CardTitle>Buyback opportunities</CardTitle></CardHeader><CardBody>
          {opps.length === 0 ? <p className="text-sm text-navy-900/70">None right now. Opportunities appear when an opted-in guest holds a booking and waitlisted demand would beat their price. <Link href="/partner/buybacks" className="underline">Buyback rules</Link></p> :
            <ul className="space-y-3">{opps.slice(0, 3).map((o) => <li key={o.reservation_id} className="text-sm"><p className="font-medium">{o.title}</p><p className="text-navy-900/70">Booked at {aud(o.price_cents)} · waitlist up to {aud(o.candidateMax)} · est. benefit <strong className="text-success">+{aud(o.quote.netBenefitCents)}</strong></p></li>)}<Link href="/partner/buybacks" className="text-sm font-semibold underline">Review all</Link></ul>}
        </CardBody></Card>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Arriving in the next 48 hours</CardTitle></CardHeader><CardBody>{soon.length === 0 ? <p className="text-sm text-navy-900/60">No arrivals.</p> : <ul className="divide-y divide-navy-900/10 text-sm">{soon.map((r) => <li key={r.reference} className="flex justify-between gap-3 py-2"><span><strong>{r.guest_name}</strong> · {r.guests} guest{r.guests > 1 ? "s" : ""}<br /><span className="text-navy-900/60">{r.title}</span></span><span className="text-right text-navy-900/60">{fmtDateTime(r.starts_at)}<br /><span className="font-mono text-xs">{r.reference}</span></span></li>)}</ul>}</CardBody></Card>
        <Card><CardHeader><CardTitle>Low or no stock</CardTitle></CardHeader><CardBody>{low.length === 0 ? <p className="text-sm text-navy-900/60">All listings have healthy stock.</p> : <ul className="divide-y divide-navy-900/10 text-sm">{low.map((l) => <li key={l.id} className="flex justify-between py-2"><Link href={`/partner/inventory/${l.id}`} className="underline">{l.title}</Link><span>{l.available_units} of {l.total_units} left</span></li>)}</ul>}</CardBody></Card>
      </div>
    </>
  );
}
