import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSeller, maxAskFor } from "@/lib/domain/resale";
import { aud, fmtDateTime } from "@/lib/util";
import { listingStatusAction, updateAskAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "My listings" };

export default async function Selling() {
  const u = await requirePermission("customer:account", "/account/selling");
  const db = await getDb();
  const seller = await getSeller(db, u.id);
  const rows = (await db.query<any>(
    `select l.*, v.name as venue, v.max_markup_bps from resale_listings l join venues v on v.id = l.venue_id where l.seller_id = $1 and l.status <> 'removed' order by l.created_at desc`, [u.id])).rows;
  return (
    <>
      <PageHeader title="My listings" eyebrow="Selling"><Button asChild variant="gold"><Link href={seller ? "/sell/new" : "/sell/setup"}><Plus /> {seller ? "List a booking" : "Become a seller"}</Link></Button></PageHeader>
      {seller?.strikes > 0 && <p role="note" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">You have {seller.strikes} strike{seller.strikes > 1 ? "s" : ""}. Failed or cancelled sales add strikes; {3} suspends selling.</p>}
      {rows.length === 0 ? <EmptyState title="Nothing listed yet">Pass on a booking, reservation or ticket you can&apos;t use.</EmptyState> : (
        <div className="card p-2"><Table><thead><tr><TH>Listing</TH><TH>When</TH><TH>Stock</TH><TH>Price each</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></thead><tbody>
          {rows.map((l) => <tr key={l.id}><TD><Link className="font-medium hover:underline" href={`/resale/${l.id}`}>{l.title}</Link><p className="text-xs text-navy-900/60">{l.venue}</p></TD><TD>{fmtDateTime(l.starts_at)}</TD><TD>{l.quantity_available} of {l.quantity_total}</TD>
            <TD>{["active", "paused", "sold_out"].includes(l.status) ? (
              <ActionForm action={updateAskAction} submit="Update" size="sm" variant="outline" className="flex items-center gap-1.5"><input type="hidden" name="listingId" value={l.id} /><label className="sr-only" htmlFor={`a-${l.id}`}>Asking price</label><Input id={`a-${l.id}`} name="ask" inputMode="decimal" defaultValue={(l.ask_unit_cents / 100).toFixed(2)} className="h-9 w-24" /></ActionForm>) : aud(l.ask_unit_cents)}
              <p className="mt-1 text-[11px] text-navy-900/50">cap {aud(maxAskFor(l.original_unit_cents, l.max_markup_bps))}</p></TD>
            <TD><StatusBadge status={l.status} /></TD>
            <TD><form action={listingStatusAction} className="flex gap-1"><input type="hidden" name="listingId" value={l.id} />{l.status === "active" && <Button name="op" value="pause" size="sm" variant="outline">Pause</Button>}{l.status === "paused" && <Button name="op" value="resume" size="sm" variant="gold">Resume</Button>}{["active", "paused", "sold_out", "expired"].includes(l.status) && <Button name="op" value="remove" size="sm" variant="ghost">Remove</Button>}</form></TD></tr>)}
        </tbody></Table></div>)}
    </>
  );
}
