import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { Stat } from "@/components/charts";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reconcile } from "@/lib/domain/finance";
import { aud, fmtDateTime } from "@/lib/util";
import { adminRefundAction, runAllPayoutsAction, runPayoutAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Transactions" };

export default async function Transactions() {
  await requirePermission("admin:finance", "/admin/transactions");
  const db = await getDb();
  const rec = await reconcile(db);
  const pays = (await db.query<any>(
    `select p.*, o.reference as order_ref, o.source, u.email from payments p join orders o on o.id = p.order_id join users u on u.id = o.customer_id order by p.created_at desc limit 40`)).rows;
  const refunds = (await db.query<any>("select f.*, r.reference from refunds f left join reservations r on r.id = f.reservation_id order by f.created_at desc limit 25")).rows;
  const payouts = (await db.query<any>("select po.*, pa.business_name from partner_payouts po join partners pa on pa.id = po.partner_id order by po.created_at desc limit 15")).rows;
  const balances = (await db.query<any>(`select pa.id, pa.business_name, coalesce(sum(e.amount_cents) filter (where e.payout_id is null),0)::bigint as open from partners pa left join ledger_entries e on e.partner_id = pa.id where pa.status = 'approved' group by pa.id order by 3 desc`)).rows;
  return (
    <>
      <PageHeader title="Transactions" eyebrow="Payments · refunds · payouts" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Captured" value={aud(rec.captured)} /><Stat label="Refunded" value={aud(rec.refunded)} /><Stat label="Compensation" value={aud(rec.compensation)} /><Stat label="Ledger vs. cash" value={rec.balanced ? "Balanced" : `Off by ${aud(rec.difference)}`} hint={`partners ${aud(rec.partnerLedger)} + platform ${aud(rec.platformFees)} = held ${aud(rec.cashHeld)}`} tone={rec.balanced ? undefined : "danger"} /></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Partner balances &amp; payouts</CardTitle></CardHeader><CardBody>
          <ul className="divide-y divide-navy-900/10 text-sm">{balances.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 py-2"><span>{b.business_name}</span><span className="flex items-center gap-3"><strong>{aud(b.open)}</strong><ActionForm action={runPayoutAction} submit="Pay out" size="sm" variant="outline"><input type="hidden" name="partnerId" value={b.id} /></ActionForm></span></li>)}</ul>
          <ActionForm action={runAllPayoutsAction} submit="Run payouts for everyone" size="sm" variant="gold" className="mt-3" />
          <p className="mt-2 text-xs text-navy-900/60">Only completed or cancelled bookings are paid out; negative balances carry forward. Idempotent transfer keys prevent double payment.</p>
          {payouts.length > 0 && <ul className="mt-4 space-y-1 border-t border-navy-900/10 pt-3 text-xs">{payouts.map((p) => <li key={p.id} className="flex justify-between"><span>{fmtDateTime(p.created_at)} · {p.business_name}</span><span>{aud(p.net_cents)} <StatusBadge status={p.status} /></span></li>)}</ul>}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Issue a refund</CardTitle></CardHeader><CardBody>
          <ActionForm action={adminRefundAction} submit="Issue refund" variant="outline" className="space-y-3"><input type="hidden" name="key" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Booking reference" htmlFor="ref"><Input id="ref" name="reference" placeholder="RS-XXXXXXXX" required /></Field><Field label="Amount ($)" htmlFor="amt"><Input id="amt" name="amount" inputMode="decimal" required /></Field></div>
            <Field label="Reason (audited)" htmlFor="why"><Input id="why" name="reason" required minLength={5} /></Field></ActionForm>
          <h3 className="mt-5 text-sm font-semibold">Recent refunds</h3><ul className="mt-2 space-y-1 text-xs">{refunds.map((f) => <li key={f.id} className="flex justify-between"><span>{f.reference ?? "—"} · {f.kind}</span><span>{aud(f.amount_cents)} <StatusBadge status={f.status} /></span></li>)}</ul>
        </CardBody></Card>
      </div>
      <div className="card mt-6 p-2"><Table><thead><tr><TH>Date</TH><TH>Order</TH><TH>Customer</TH><TH>Provider</TH><TH className="text-right">Amount</TH><TH className="text-right">Refunded</TH><TH>Status</TH></tr></thead><tbody>
        {pays.map((p) => <tr key={p.id}><TD>{fmtDateTime(p.created_at)}</TD><TD className="font-mono text-xs">{p.order_ref}{p.source !== "direct" && <Badge tone="gold" className="ml-1">{p.source}</Badge>}</TD><TD className="text-xs">{p.email}</TD><TD>{p.provider}</TD><TD className="text-right tabular-nums">{aud(p.amount_cents)}</TD><TD className="text-right tabular-nums">{aud(p.refunded_cents)}</TD><TD><StatusBadge status={p.status} /></TD></tr>)}
      </tbody></Table></div>
    </>
  );
}
