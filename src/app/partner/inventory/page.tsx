import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";
import { listingStatusAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "Inventory" };

export default async function Inventory() {
  const u = await requirePermission("partner:portal", "/partner/inventory");
  const rows = (await (await getDb()).query<any>(
    `select l.id, l.title, l.status, l.starts_at, l.current_price_cents, l.pricing_mode, v.name as venue, a.total_units, a.available_units, a.held_units, a.booked_units, a.offered_units,
            (select count(*)::int from waitlist_entries w where w.listing_id = l.id and w.status in ('active','offered')) as wl
       from listings l join venues v on v.id = l.venue_id join listing_availability a on a.listing_id = l.id where l.partner_id = $1 order by l.starts_at desc`, [u.partnerId])).rows;
  return (
    <>
      <PageHeader title="Inventory" eyebrow="Rooms · tables · tickets"><Button asChild variant="gold"><Link href="/partner/inventory/new"><Plus /> New listing</Link></Button></PageHeader>
      {rows.length === 0 ? <EmptyState title="No listings yet">Add a venue in Business settings, then publish your first unsold inventory.</EmptyState> : (
        <div className="card p-2"><Table><thead><tr><TH>Listing</TH><TH>Starts</TH><TH>Price</TH><TH>Stock</TH><TH>Waitlist</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><TD><Link className="font-medium hover:underline" href={`/partner/inventory/${r.id}`}>{r.title}</Link><p className="text-xs text-navy-900/60">{r.venue}</p></TD><TD>{fmtDateTime(r.starts_at)}</TD>
            <TD>{aud(r.current_price_cents, { whole: true })}<p className="text-xs text-navy-900/60">{r.pricing_mode}</p></TD><TD>{r.available_units} avail · {r.booked_units} sold{r.held_units ? ` · ${r.held_units} held` : ""}{r.offered_units ? ` · ${r.offered_units} offered` : ""}<p className="text-xs text-navy-900/60">of {r.total_units}</p></TD><TD>{r.wl}</TD><TD><StatusBadge status={r.status} /></TD>
            <TD><form action={listingStatusAction} className="flex gap-1"><input type="hidden" name="listingId" value={r.id} />{r.status === "published" ? <Button name="status" value="paused" size="sm" variant="outline">Pause</Button> : r.status !== "closed" ? <Button name="status" value="published" size="sm" variant="gold">Publish</Button> : null}</form></TD></tr>)}
        </tbody></Table></div>)}
    </>
  );
}
