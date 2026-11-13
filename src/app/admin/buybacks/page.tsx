import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Input, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { featureOn, getSetting } from "@/lib/domain/settings";
import { aud, fmtDateTime } from "@/lib/util";
import { buybackDecisionAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Buyback monitoring" };

export default async function Buybacks() {
  await requirePermission("admin:portal", "/admin/buybacks");
  const db = await getDb();
  const gate = await getSetting<any>(db, "features.buyback", {});
  const on = await featureOn(db, "features.buyback");
  const rows = (await db.query<any>(
    `select b.*, l.title, l.category, l.starts_at, r.reference, p.business_name, cu.email as customer_email from buyback_offers b join listings l on l.id = b.listing_id join reservations r on r.id = b.reservation_id
       join partners p on p.id = b.partner_id join users cu on cu.id = b.customer_id order by (b.status = 'pending_admin') desc, b.created_at desc limit 100`)).rows;
  const comp = (await db.query<any>("select c.*, u.email from compensation_payments c join users u on u.id = c.customer_id where c.status = 'pending' order by c.created_at")).rows;
  const consents = Number((await db.query<any>("select count(*)::int n from buyback_consents where kind = 'checkout_opt_in'")).rows[0].n);
  const waiting = rows.filter((r) => r.status === "pending_admin");
  return (
    <>
      <PageHeader title="Buyback monitoring" eyebrow="Approvals & oversight"><Badge tone={on ? "success" : "danger"}>{on ? "feature ON" : "feature OFF"}</Badge></PageHeader>
      {on && String(gate.legal_review_ref).startsWith("SANDBOX") && <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm"><strong>Enabled with a sandbox reference.</strong> “{gate.legal_review_ref}”. Before real customers use this, obtain legal sign-off and record the real review reference in System configuration.</p>}
      <p className="mb-4 text-sm text-navy-900/70">{consents} customer opt-ins recorded · every acceptance stores the exact terms text the customer saw.</p>
      {waiting.length > 0 && <section className="mb-8"><h2 className="mb-3 text-xl font-semibold">Awaiting your approval</h2><ul className="space-y-3">{waiting.map((o) => (
        <Card key={o.id} className="border-gold-500/50 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-semibold">{o.business_name} → {o.title} <span className="font-mono text-xs">({o.reference})</span></p><p className="text-sm text-navy-900/70">Guest paid {aud(o.original_amount_cents)} · compensation {aud(o.compensation_cents)} · resale {aud(o.resale_price_cents)} · partner net benefit {aud(o.net_benefit_cents)}</p><p className="text-xs text-navy-900/60 capitalize">{o.category}{o.category === "event" ? " — regulated ticket resale: check price cap and event terms" : ""} · customer sees nothing until you approve</p></div>
          <ActionForm action={buybackDecisionAction} hideSubmit className="flex flex-col items-end gap-2"><input type="hidden" name="offerId" value={o.id} /><Input name="note" placeholder="Note (optional)" aria-label="Decision note" className="h-9 w-56" /><div className="flex gap-2"><Button name="approve" value="true" size="sm" variant="gold">Approve</Button><Button name="approve" value="false" size="sm" variant="outline">Decline</Button></div></ActionForm></div></Card>))}</ul></section>}
      {comp.length > 0 && <section className="mb-8"><h2 className="mb-2 text-xl font-semibold">Compensation awaiting manual disbursement</h2><ul className="space-y-1 text-sm">{comp.map((c) => <li key={c.id} className="flex justify-between rounded-lg bg-amber-50 px-3 py-2"><span>{c.email}</span><strong>{aud(c.amount_cents)}</strong></li>)}</ul></section>}
      <h2 className="mb-3 text-xl font-semibold">All proposals</h2>
      {rows.length === 0 ? <EmptyState title="No buyback activity yet" /> : <div className="card p-2"><Table><thead><tr><TH>Partner / booking</TH><TH>Guest receives</TH><TH>Resale</TH><TH>Platform fee</TH><TH>Status</TH><TH>Created</TH></tr></thead><tbody>
        {rows.map((o) => <tr key={o.id}><TD><p className="font-medium">{o.business_name}</p><p className="text-xs text-navy-900/60">{o.title} · {o.reference}</p></TD><TD>{aud(o.original_amount_cents)} + {aud(o.compensation_cents)}</TD><TD>{aud(o.resale_price_cents)}</TD><TD>{aud(o.platform_fee_cents)}</TD><TD><StatusBadge status={o.status} /></TD><TD className="text-xs">{fmtDateTime(o.created_at)}</TD></tr>)}</tbody></Table></div>}
      <p className="mt-4 text-sm"><Link href="/admin/system" className="underline">Legal gate & feature flags →</Link></p>
    </>
  );
}
