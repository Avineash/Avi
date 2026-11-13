import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "Payments & refunds" };

export default async function Payments() {
  const u = await requirePermission("customer:account", "/account/payments");
  const db = await getDb();
  const rows = (await db.query<any>(
    `select * from (
       select p.created_at as at, 'Payment' as kind, p.amount_cents as cents, p.status, p.provider, (select id from reservations where order_id = p.order_id limit 1) as rid, (select reference from reservations where order_id = p.order_id limit 1) as ref
         from payments p join orders o on o.id = p.order_id where o.customer_id = $1 and p.status <> 'requires_payment'
       union all
       select f.created_at, 'Refund (' || f.kind || ')', -f.amount_cents, f.status, 'refund', r.id, r.reference from refunds f join reservations r on r.id = f.reservation_id where r.customer_id = $1
       union all
       select c.created_at, 'Compensation', -c.amount_cents, c.status, 'compensation', null, null from compensation_payments c where c.customer_id = $1
     ) t order by at desc`, [u.id])).rows;
  const reqs = (await db.query<any>("select rr.*, r.reference from refund_requests rr join reservations r on r.id = rr.reservation_id where rr.requested_by = $1 order by rr.created_at desc", [u.id])).rows;
  return (
    <>
      <PageHeader title="Payments & refunds" eyebrow="Transaction history" />
      {rows.length === 0 ? <EmptyState title="No transactions yet" /> : (
        <div className="card p-2"><Table><thead><tr><TH>Date</TH><TH>Type</TH><TH>Booking</TH><TH className="text-right">Amount</TH><TH>Status</TH></tr></thead><tbody>
          {rows.map((r, i) => <tr key={i}><TD>{fmtDateTime(r.at)}</TD><TD>{r.kind}{r.provider === "sandbox" && <Badge tone="gold" className="ml-2">test</Badge>}</TD><TD>{r.rid ? <Link className="font-mono text-xs underline" href={`/account/bookings/${r.rid}`}>{r.ref}</Link> : "—"}</TD><TD className={`text-right tabular-nums ${r.cents < 0 ? "text-success" : ""}`}>{r.cents < 0 ? "+" : "−"}{aud(Math.abs(r.cents))}</TD><TD><StatusBadge status={r.status} /></TD></tr>)}
        </tbody></Table></div>)}
      <p className="mt-2 text-xs text-navy-900/60">Payments show as negative (money out); refunds and compensation as positive (money in).</p>
      {reqs.length > 0 && <section className="mt-8"><h2 className="mb-3 text-xl font-semibold">Refund requests</h2><ul className="space-y-2 text-sm">{reqs.map((r) => <li key={r.id} className="card flex items-center justify-between gap-3 p-3"><span>{r.reference} · {aud(r.amount_cents)} — {r.reason.slice(0, 80)}</span><StatusBadge status={r.status} /></li>)}</ul></section>}
    </>
  );
}
