import type { Metadata } from "next";
import { Stat } from "@/components/charts";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { partnerBalance } from "@/lib/domain/finance";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "Earnings & payouts" };
const KIND: Record<string, string> = { sale: "Sale", commission: "Commission", refund: "Refund", commission_reversal: "Commission reversed", compensation: "Buyback compensation", payment_cost: "Payment processing (buyback)", chargeback: "Chargeback", adjustment: "Adjustment" };

export default async function Earnings() {
  const u = await requirePermission("partner:portal", "/partner/earnings");
  const db = await getDb();
  const b = await partnerBalance(db, u.partnerId!);
  const ledger = (await db.query<any>(`select e.*, r.reference from ledger_entries e left join reservations r on r.id = e.reservation_id where e.partner_id = $1 order by e.id desc limit 60`, [u.partnerId])).rows;
  const payouts = (await db.query<any>("select * from partner_payouts where partner_id = $1 order by created_at desc limit 20", [u.partnerId])).rows;
  const fees = (await db.query<any>(`select to_char(created_at at time zone 'Australia/Melbourne','YYYY-MM') as m, coalesce(sum(amount_cents),0)::bigint fee, coalesce(sum(gst_cents),0)::bigint gst from platform_fees where partner_id = $1 and kind in ('commission','buyback_fee','resale_fee') group by 1 order by 1 desc limit 6`, [u.partnerId])).rows;
  return (
    <>
      <PageHeader title="Earnings & payouts" eyebrow="Money" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Payable now" value={aud(b.payable)} hint="completed stays & events" tone="gold" /><Stat label="Pending" value={aud(b.pending)} hint="released after the stay" /><Stat label="Paid out" value={aud(b.paidOut)} /><Stat label="Payout schedule" value="After stay" hint="Weekly sweep; balances carry forward" /></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card><CardHeader><CardTitle>Ledger</CardTitle></CardHeader><CardBody>{ledger.length === 0 ? <EmptyState title="No activity yet" /> : <Table><thead><tr><TH>Date</TH><TH>Entry</TH><TH>Booking</TH><TH className="text-right">Amount</TH><TH>Payout</TH></tr></thead><tbody>{ledger.map((e) => <tr key={e.id}><TD className="whitespace-nowrap">{fmtDateTime(e.created_at)}</TD><TD>{KIND[e.kind] ?? e.kind}</TD><TD className="font-mono text-xs">{e.reference ?? "—"}</TD><TD className={`text-right tabular-nums ${Number(e.amount_cents) < 0 ? "text-danger" : ""}`}>{aud(e.amount_cents)}</TD><TD>{e.payout_id ? "paid/queued" : "open"}</TD></tr>)}</tbody></Table>}</CardBody></Card>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Payouts</CardTitle></CardHeader><CardBody>{payouts.length === 0 ? <p className="text-sm text-navy-900/60">No payouts yet.</p> : <ul className="divide-y divide-navy-900/10 text-sm">{payouts.map((p) => <li key={p.id} className="flex items-center justify-between py-2"><span>{fmtDateTime(p.created_at)}<br /><span className="text-xs text-navy-900/60">{p.entries_count} entries</span></span><span className="text-right"><strong>{aud(p.net_cents)}</strong><br /><StatusBadge status={p.status} /></span></li>)}</ul>}</CardBody></Card>
          <Card><CardHeader><CardTitle>Commission invoices (GST)</CardTitle></CardHeader><CardBody>{fees.length === 0 ? <p className="text-sm text-navy-900/60">None yet.</p> : <table className="w-full text-sm"><thead><tr className="text-left text-xs text-navy-900/60"><th>Month</th><th className="text-right">Fees (incl. GST)</th><th className="text-right">GST</th></tr></thead><tbody>{fees.map((f) => <tr key={f.m}><td>{f.m}</td><td className="text-right">{aud(f.fee)}</td><td className="text-right">{aud(f.gst)}</td></tr>)}</tbody></table>}<p className="mt-2 text-xs text-navy-900/60">Platform fees are GST-inclusive; the GST column is claimable as an input tax credit if you&apos;re registered. Confirm treatment with your accountant.</p></CardBody></Card>
        </div>
      </div>
    </>
  );
}
