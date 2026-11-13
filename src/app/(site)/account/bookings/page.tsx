import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "My bookings" };

export default async function Bookings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "upcoming" } = await searchParams;
  const u = await requirePermission("customer:account", "/account/bookings");
  const upcoming = tab !== "previous";
  const rows = (await (await getDb()).query<any>(
    `select r.id, r.reference, r.status, r.total_cents, l.title, l.starts_at, l.category, v.name as venue from reservations r join listings l on l.id = r.listing_id join venues v on v.id = l.venue_id
      where r.customer_id = $1 and r.status <> 'pending_payment' and r.status <> 'expired' and (${upcoming ? "r.status = 'confirmed' and l.starts_at > now()" : "not (r.status = 'confirmed' and l.starts_at > now())"})
      order by l.starts_at ${upcoming ? "asc" : "desc"}`, [u.id])).rows;
  return (
    <>
      <PageHeader title={upcoming ? "Upcoming bookings" : "Previous bookings"} eyebrow="Bookings">
        <Button asChild size="sm" variant={upcoming ? "default" : "outline"}><Link href="/account/bookings?tab=upcoming">Upcoming</Link></Button>
        <Button asChild size="sm" variant={!upcoming ? "default" : "outline"}><Link href="/account/bookings?tab=previous">Previous</Link></Button>
      </PageHeader>
      {rows.length === 0 ? <EmptyState title={upcoming ? "No upcoming bookings" : "No previous bookings"}><Link className="underline" href="/search?sort=soonest">Browse last-minute availability</Link></EmptyState> : (
        <div className="card p-2"><Table><thead><tr><TH>Reference</TH><TH>Experience</TH><TH>When</TH><TH>Total</TH><TH>Status</TH><TH><span className="sr-only">Open</span></TH></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><TD className="font-mono text-xs">{r.reference}</TD><TD><p className="font-medium">{r.title}</p><p className="text-xs text-navy-900/60">{r.venue}</p></TD><TD>{fmtDateTime(r.starts_at)}</TD><TD>{aud(r.total_cents)}</TD><TD><StatusBadge status={r.status} /></TD><TD><Link href={`/account/bookings/${r.id}`} className="font-semibold underline">View</Link></TD></tr>)}
        </tbody></Table></div>
      )}
    </>
  );
}
