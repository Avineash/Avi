import type { Metadata } from "next";
import { Stat } from "@/components/charts";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { sellerBalance } from "@/lib/domain/resale";
import { aud, fmtDateTime } from "@/lib/util";
import { withdrawAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "Earnings & payouts" };
const KIND: Record<string, string> = { sale: "Sale", fee: "Seller fee", refund: "Refund to buyer", fee_reversal: "Fee reversed", adjustment: "Adjustment" };

export default async function Earnings() {
  const u = await requirePermission("customer:account", "/account/earnings");
  const db = await getDb();
  const b = await sellerBalance(db, u.id);
  const ledger = (await db.query<any>("select e.*, r.reference from seller_ledger e left join resale_orders r on r.id = e.resale_order_id where e.seller_id = $1 order by e.id desc limit 50", [u.id])).rows;
  const payouts = (await db.query<any>("select * from seller_payouts where seller_id = $1 order by created_at desc limit 20", [u.id])).rows;
  return (
    <>
      <PageHeader title="Earnings & payouts" eyebrow="Selling" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="In escrow" value={aud(b.escrow)} hint="released when the buyer confirms" /><Stat label="Available" value={aud(b.available)} tone="gold" /><Stat label="Paid out" value={aud(b.paidOut)} />
        <div className="card flex flex-col justify-between p-4"><p className="text-xs font-medium uppercase tracking-wide text-navy-900/60">Withdraw</p><ActionForm action={withdrawAction} submit="Withdraw available funds" size="sm" variant="gold" className="mt-2" /></div></div>
      <p className="mt-3 text-xs text-navy-900/60">Payouts are simulated in the sandbox. In production they go to your connected Stripe account.</p>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card><CardHeader><CardTitle>Ledger</CardTitle></CardHeader><CardBody>{ledger.length === 0 ? <EmptyState title="No activity yet" /> : <Table><thead><tr><TH>Date</TH><TH>Entry</TH><TH>Sale</TH><TH className="text-right">Amount</TH><TH>State</TH></tr></thead><tbody>{ledger.map((e) => <tr key={e.id}><TD className="whitespace-nowrap">{fmtDateTime(e.created_at)}</TD><TD>{KIND[e.kind]}</TD><TD className="font-mono text-xs">{e.reference}</TD><TD className={`text-right tabular-nums ${Number(e.amount_cents) < 0 ? "text-danger" : ""}`}>{aud(e.amount_cents)}</TD><TD className="text-xs">{e.payout_id ? "paid out" : e.released ? "available" : "escrow"}</TD></tr>)}</tbody></Table>}</CardBody></Card>
        <Card><CardHeader><CardTitle>Payouts</CardTitle></CardHeader><CardBody>{payouts.length === 0 ? <p className="text-sm text-navy-900/60">No payouts yet.</p> : <ul className="divide-y divide-navy-900/10 text-sm">{payouts.map((p) => <li key={p.id} className="flex items-center justify-between py-2"><span>{fmtDateTime(p.created_at)}</span><span className="text-right"><strong>{aud(p.net_cents)}</strong><br /><StatusBadge status={p.status} /></span></li>)}</ul>}</CardBody></Card>
      </div>
    </>
  );
}
