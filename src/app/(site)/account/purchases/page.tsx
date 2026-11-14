import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "My purchases" };

export default async function Purchases() {
  const u = await requirePermission("customer:account", "/account/purchases");
  const rows = (await (await getDb()).query<any>(
    `select r.id, r.reference, r.status, r.total_cents, r.quantity, l.title, l.starts_at, v.name as venue, sp.display_name as seller from resale_orders r join resale_listings l on l.id = r.listing_id
       join venues v on v.id = l.venue_id join seller_profiles sp on sp.user_id = r.seller_id where r.buyer_id = $1 and r.status <> 'expired' order by r.created_at desc`, [u.id])).rows;
  return (
    <>
      <PageHeader title="My purchases" eyebrow="Buying" />
      {rows.length === 0 ? <EmptyState title="No purchases yet"><Link className="underline" href="/search?sort=soonest">Browse what&apos;s on offer</Link></EmptyState> : (
        <div className="card p-2"><Table><thead><tr><TH>Reference</TH><TH>Item</TH><TH>When</TH><TH>Seller</TH><TH className="text-right">Total</TH><TH>Status</TH><TH><span className="sr-only">Open</span></TH></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><TD className="font-mono text-xs">{r.reference}</TD><TD><p className="font-medium">{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.title}</p><p className="text-xs text-navy-900/60">{r.venue}</p></TD><TD>{fmtDateTime(r.starts_at)}</TD><TD>{r.seller}</TD><TD className="text-right tabular-nums">{aud(r.total_cents)}</TD><TD><StatusBadge status={r.status} /></TD><TD><Link href={`/account/purchases/${r.id}`} className="font-semibold underline">Open</Link></TD></tr>)}
        </tbody></Table></div>)}
    </>
  );
}
