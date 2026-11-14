import Link from "next/link";
import { Stat } from "@/components/charts";
import { ResaleCard } from "@/components/resale-card";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { Countdown } from "@/components/countdown";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSeller, searchResale, sellerStats } from "@/lib/domain/resale";
import { aud, fmtDateTime } from "@/lib/util";

export async function MarketDashboard() {
  const u = await requirePermission("customer:account", "/account");
  const db = await getDb();
  const seller = await getSeller(db, u.id);
  const st = await sellerStats(db, u.id);
  const buying = (await db.query<any>(
    `select r.id, r.reference, r.status, r.total_cents, r.deliver_by, l.title, l.starts_at from resale_orders r join resale_listings l on l.id = r.listing_id
      where r.buyer_id = $1 and r.status in ('paid','delivered','disputed') order by l.starts_at limit 5`, [u.id])).rows;
  const selling = (await db.query<any>(
    `select r.id, r.reference, r.status, r.deliver_by, r.subtotal_cents, l.title from resale_orders r join resale_listings l on l.id = r.listing_id
      where r.seller_id = $1 and r.status in ('paid','delivered','disputed') order by r.deliver_by nulls last limit 5`, [u.id])).rows;
  const alerts = Number((await db.query<any>("select count(*)::int n from buyer_alerts where buyer_id = $1 and status = 'active'", [u.id])).rows[0].n);
  const notes = (await db.query<any>("select * from notifications where user_id = $1 order by created_at desc limit 5", [u.id])).rows;
  const recs = await searchResale({ userId: u.id, sort: "recommended", limit: 3 });
  return (
    <>
      <PageHeader title={`Hello, ${u.name.split(" ")[0]}`} eyebrow="Overview">
        <Button asChild variant="outline" size="sm"><Link href="/search">Browse</Link></Button>
        <Button asChild variant="gold" size="sm"><Link href={seller ? "/sell/new" : "/sell/setup"}>{seller ? "List a booking" : "Become a seller"}</Link></Button>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Buying" value={buying.length} hint="in progress" />
        <Stat label="To deliver" value={st.toDeliver} hint="sales waiting on you" tone={st.toDeliver ? "danger" : undefined} />
        <Stat label="In escrow" value={aud(st.escrow, { whole: true })} hint="released on confirmation" />
        <Stat label="Available" value={aud(st.available, { whole: true })} hint={<Link href="/account/earnings" className="underline">Withdraw</Link>} tone="gold" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Purchases in progress</CardTitle></CardHeader><CardBody>
          {buying.length === 0 ? <EmptyState title="Nothing in progress"><Link className="underline" href="/search?sort=soonest">Find something for tonight</Link></EmptyState> :
            <ul className="divide-y divide-navy-900/10">{buying.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-3"><div><Link className="font-medium hover:underline" href={`/account/purchases/${r.id}`}>{r.title}</Link><p className="text-xs text-navy-900/60">{fmtDateTime(r.starts_at)} · {r.reference}</p>{r.status === "delivered" && <p className="text-xs font-semibold text-gold-700">Delivered — please confirm</p>}</div><StatusBadge status={r.status} /></li>)}</ul>}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Sales to action</CardTitle></CardHeader><CardBody>
          {selling.length === 0 ? <p className="text-sm text-navy-900/60">{seller ? "No sales waiting." : "Become a seller to pass on bookings you can't use."}</p> :
            <ul className="divide-y divide-navy-900/10">{selling.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-3"><div><Link className="font-medium hover:underline" href={`/account/sales/${r.id}`}>{r.title}</Link><p className="text-xs text-navy-900/60">{aud(r.subtotal_cents)} · {r.reference}</p>{r.status === "paid" && r.deliver_by && <p className="text-xs font-semibold text-danger">Deliver within <Countdown to={new Date(r.deliver_by).toISOString()} /></p>}</div><StatusBadge status={r.status} /></li>)}</ul>}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Notifications</CardTitle></CardHeader><CardBody>
          {notes.length === 0 ? <p className="text-sm text-navy-900/60">You&apos;re all caught up.</p> : <ul className="space-y-3">{notes.map((n) => <li key={n.id} className="text-sm"><p className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p><p className="text-navy-900/70">{n.body}</p></li>)}</ul>}
          <Link href="/account/notifications" className="mt-3 inline-block text-sm font-semibold underline">All notifications</Link>
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Alerts</CardTitle></CardHeader><CardBody><p className="text-sm text-navy-900/75">{alerts} active alert{alerts === 1 ? "" : "s"}. Tell us what you want and we&apos;ll notify you the moment it&apos;s listed.</p><Button asChild variant="outline" size="sm" className="mt-3"><Link href="/account/wanted">Manage alerts</Link></Button></CardBody></Card>
      </div>
      {recs.length > 0 && <section className="mt-8"><h2 className="mb-4 text-2xl">Recommended for you</h2><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{recs.map((l) => <ResaleCard key={l.id} l={l} signedIn />)}</div></section>}
    </>
  );
}
