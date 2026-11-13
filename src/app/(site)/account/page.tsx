import type { Metadata } from "next";
import Link from "next/link";
import { Stat } from "@/components/charts";
import { ListingCard } from "@/components/listing-card";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { customerStats } from "@/lib/domain/analytics";
import { searchListings } from "@/lib/domain/search";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "My account" };

export default async function Dashboard() {
  const u = await requirePermission("customer:account", "/account");
  const db = await getDb();
  const s = await customerStats(db, u.id);
  const next = (await db.query<any>(
    `select r.id, r.reference, r.status, l.title, l.starts_at, v.name as venue from reservations r join listings l on l.id = r.listing_id join venues v on v.id = l.venue_id
      where r.customer_id = $1 and r.status = 'confirmed' and l.starts_at > now() order by l.starts_at limit 3`, [u.id])).rows;
  const notes = (await db.query<any>("select * from notifications where user_id = $1 order by created_at desc limit 6", [u.id])).rows;
  const recs = await searchListings({ userId: u.id, sort: "recommended", availability: "available", limit: 3 });
  return (
    <>
      <PageHeader title={`Hello, ${u.name.split(" ")[0]}`} eyebrow="Dashboard" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Upcoming" value={s.upcoming} hint="confirmed bookings" />
        <Stat label="Saved so far" value={aud(s.savings, { whole: true })} hint="vs. standard prices" tone="gold" />
        <Stat label="Waitlists" value={s.waitlistActive + s.waitlistOffered} hint={s.waitlistOffered ? `${s.waitlistOffered} with an offer!` : "active"} />
        <Stat label="Open offers" value={s.openOffers} hint={<Link href="/account/offers" className="underline">Review</Link>} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Next up</CardTitle></CardHeader><CardBody>
          {next.length === 0 ? <EmptyState title="Nothing booked yet"><Link href="/search?sort=soonest" className="underline">Find something for tonight</Link></EmptyState> :
            <ul className="divide-y divide-navy-900/10">{next.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-3"><div><Link className="font-medium hover:underline" href={`/account/bookings/${r.id}`}>{r.title}</Link><p className="text-xs text-navy-900/60">{r.venue} · {fmtDateTime(r.starts_at)} · {r.reference}</p></div><StatusBadge status={r.status} /></li>)}</ul>}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Notifications</CardTitle></CardHeader><CardBody>
          {notes.length === 0 ? <p className="text-sm text-navy-900/60">You&apos;re all caught up.</p> : <ul className="space-y-3">{notes.map((n) => <li key={n.id} className="text-sm"><p className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p><p className="text-navy-900/70">{n.body}</p><p className="text-xs text-navy-900/50">{fmtDateTime(n.created_at)}</p></li>)}</ul>}
        </CardBody></Card>
      </div>
      {recs.length > 0 && <section className="mt-8"><h2 className="mb-4 text-xl font-semibold">Recommended for you</h2><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{recs.map((l) => <ListingCard key={l.id} l={l} signedIn />)}</div></section>}
    </>
  );
}
