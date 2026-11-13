import type { Metadata } from "next";
import Link from "next/link";
import { Countdown } from "@/components/countdown";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { waitlistPosition } from "@/lib/domain/waitlist";
import { aud, fmtDateTime } from "@/lib/util";
import { leaveWaitlistAction } from "@/app/actions/waitlist";

export const metadata: Metadata = { title: "My waitlists" };

export default async function Waitlists({ searchParams }: { searchParams: Promise<{ joined?: string }> }) {
  const { joined } = await searchParams;
  const u = await requirePermission("customer:account", "/account/waitlists");
  const db = await getDb();
  const rows = (await db.query<any>(
    `select w.*, l.title, l.starts_at, l.current_price_cents, l.id as listing_id, v.name as venue, a.available_units,
            (select expires_at from waitlist_offers o where o.entry_id = w.id and o.status = 'pending' limit 1) as offer_expires
       from waitlist_entries w join listings l on l.id = w.listing_id join venues v on v.id = l.venue_id join listing_availability a on a.listing_id = l.id
      where w.customer_id = $1 and w.status in ('active','offered') order by w.created_at desc`, [u.id])).rows;
  const pos = await Promise.all(rows.map((r) => waitlistPosition(db, r.id)));
  return (
    <>
      <PageHeader title="My waitlists" eyebrow="Waitlist" />
      {joined && <p role="status" className="mb-4 rounded-xl bg-success/10 p-3 text-sm text-success">You&apos;re on the waitlist. We&apos;ll notify you the moment a place is offered.</p>}
      {rows.length === 0 ? <EmptyState title="You're not on any waitlists"><Link className="underline" href="/search?avail=soldout">See sold-out listings you can join</Link></EmptyState> : (
        <ul className="space-y-4">{rows.map((r, i) => (
          <Card key={r.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4">
            <div><Link href={`/listings/${r.listing_id}`} className="font-serif text-lg font-semibold hover:underline">{r.title}</Link><p className="text-sm text-navy-900/70">{r.venue} · {fmtDateTime(r.starts_at)}</p>
              <p className="mt-2 text-sm">Your maximum: <strong>{r.max_price_cents ? aud(r.max_price_cents) : "listed price"}</strong> · Current price {aud(r.current_price_cents)}</p>
              <p className="text-sm text-navy-900/70">{r.status === "offered" ? <>Offer waiting — <Link className="font-semibold underline" href="/account/offers">respond within <Countdown to={new Date(r.offer_expires).toISOString()} /></Link></> : pos[i] ? `Position ${pos[i]!.pos} of ${pos[i]!.total}${r.available_units > 0 ? " · now available to book directly!" : ""}` : ""}</p></div>
            <div className="flex items-center gap-3"><StatusBadge status={r.status} />{r.status === "active" && <form action={leaveWaitlistAction}><input type="hidden" name="entryId" value={r.id} /><Button size="sm" variant="outline">Leave</Button></form>}</div>
          </div></Card>))}</ul>)}
    </>
  );
}
