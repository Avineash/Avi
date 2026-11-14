import type { Metadata } from "next";
import Link from "next/link";
import { Countdown } from "@/components/countdown";
import { EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "My sales" };

export default async function Sales() {
  const u = await requirePermission("customer:account", "/account/sales");
  const rows = (await (await getDb()).query<any>(
    `select r.id, r.reference, r.status, r.quantity, r.subtotal_cents, r.seller_fee_cents, r.deliver_by, l.title, l.starts_at from resale_orders r join resale_listings l on l.id = r.listing_id
      where r.seller_id = $1 and r.status not in ('pending_payment','expired') order by (r.status = 'paid') desc, r.created_at desc`, [u.id])).rows;
  return (
    <>
      <PageHeader title="My sales" eyebrow="Selling" />
      {rows.length === 0 ? <EmptyState title="No sales yet" /> : (
        <div className="card p-2"><Table><thead><tr><TH>Reference</TH><TH>Item</TH><TH>When</TH><TH className="text-right">You receive</TH><TH>Status</TH><TH><span className="sr-only">Open</span></TH></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><TD className="font-mono text-xs">{r.reference}</TD><TD><p className="font-medium">{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.title}</p>{r.status === "paid" && <p className="text-xs font-semibold text-danger">Deliver within <Countdown to={new Date(r.deliver_by).toISOString()} /></p>}</TD><TD>{fmtDateTime(r.starts_at)}</TD><TD className="text-right tabular-nums">{aud(r.subtotal_cents - r.seller_fee_cents)}</TD><TD><StatusBadge status={r.status} /></TD><TD><Link href={`/account/sales/${r.id}`} className="font-semibold underline">{r.status === "paid" ? "Deliver" : "Open"}</Link></TD></tr>)}
        </tbody></Table></div>)}
    </>
  );
}
