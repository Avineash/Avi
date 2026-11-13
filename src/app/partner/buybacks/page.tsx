import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, StatusBadge, Table, TD, TH, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { findOpportunities } from "@/lib/domain/buyback";
import { featureOn } from "@/lib/domain/settings";
import { LEGAL_REVIEW_NOTICE } from "@/lib/domain/legal";
import { aud, fmtDateTime } from "@/lib/util";
import { proposeBuybackAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "Buyback requests" };

function Quote({ q }: { q: any }) {
  const row = (l: string, c: number, strong?: boolean, tone?: string) => <div className={`flex justify-between gap-6 ${strong ? "border-t border-navy-900/20 pt-1 font-semibold" : ""} ${tone ?? ""}`}><dt>{l}</dt><dd className="tabular-nums">{c < 0 ? "−" : ""}{aud(Math.abs(c))}</dd></div>;
  return (
    <dl className="space-y-1 text-sm">
      <p className="font-semibold">If the guest keeps their booking</p>
      {row("Original booking (ex. service fee)", q.originalPriceCents)}{row("Commission already charged", -q.originalCommissionCents)}{row("You keep", q.partnerKeepNetCents, true)}
      <p className="pt-2 font-semibold">If the guest accepts and the waitlisted customer buys</p>
      {row("Resale price", q.resalePriceCents)}{row("Buyback fee (platform)", -q.buybackFeeCents)}{row("Compensation to original guest", -q.compensationCents)}{row("Non-refundable payment processing on the original", -q.paymentCostCents)}{row("You receive", q.partnerBuybackNetCents, true)}
      <div className="mt-2 flex justify-between rounded-lg bg-success/10 px-3 py-2 font-semibold text-success"><dt>Net benefit to you</dt><dd>+{aud(q.netBenefitCents)}</dd></div>
      <p className="pt-1 text-xs text-navy-900/60">The original guest receives {aud(q.originalTotalCents)} refund + {aud(q.compensationCents)} compensation = {aud(q.customerAReceivesCents)}. The new customer pays {aud(q.resaleTotalCents)} incl. a {aud(q.resaleCustomerFeeCents)} service fee. Risk: if the waitlisted customer doesn&apos;t complete the purchase, compensation already paid is not recoverable and the room goes back on sale.</p>
    </dl>
  );
}

export default async function Buybacks() {
  const u = await requirePermission("partner:portal", "/partner/buybacks");
  const db = await getDb();
  const on = await featureOn(db, "features.buyback");
  const p = (await db.query<any>("select * from partners where id = $1", [u.partnerId])).rows[0];
  const opps = on && p.buyback_enabled && p.status === "approved" ? await findOpportunities(u.partnerId!) : [];
  const offers = (await db.query<any>(
    `select b.*, l.title, l.starts_at, r.reference from buyback_offers b join listings l on l.id = b.listing_id join reservations r on r.id = b.reservation_id where b.partner_id = $1 order by b.created_at desc limit 50`, [u.partnerId])).rows;
  const decided = offers.filter((o) => ["accepted", "processing", "resale_pending", "completed", "completed_unsold", "rejected", "expired"].includes(o.status));
  const rate = decided.length ? decided.filter((o) => !["rejected", "expired"].includes(o.status)).length / decided.length : 0;
  return (
    <>
      <PageHeader title="Buyback requests" eyebrow="Customer-consented reallocation"><Link href="/partner/settings#buyback" className="text-sm font-semibold underline">Buyback rules</Link></PageHeader>
      {!on && <div role="alert" className="mb-6 flex gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger" /><p><strong>Customer buyback is switched off platform-wide.</strong> {LEGAL_REVIEW_NOTICE}</p></div>}
      {on && !p.buyback_enabled && <div className="mb-6 rounded-2xl bg-ivory-200 p-4 text-sm">You haven&apos;t enabled buyback for your business. Turn it on in <Link className="underline" href="/partner/settings#buyback">Business settings</Link>.</div>}
      <Card className="mb-6 bg-ivory-200 p-5 text-sm"><p className="font-semibold">How buyback works — and what it can&apos;t do</p><ul className="mt-2 list-disc space-y-1 pl-5 text-navy-900/80"><li>Only bookings whose guest <strong>opted in at checkout</strong> are eligible. You never cancel a guest&apos;s booking — you send an optional offer they can decline.</li><li>The waitlisted customer is chosen by your published waitlist policy, not hand-picked.</li><li>The guest gets a full refund plus the compensation you set (within your min/max). Over-threshold offers (and all event tickets) need administrator approval first.</li><li>The room is released only after the refund has succeeded and the compensation is paid; then the waitlisted customer gets a time-limited offer.</li></ul></Card>

      <h2 className="mb-3 text-xl font-semibold">Opportunities</h2>
      {opps.length === 0 ? <EmptyState title="No profitable opportunities right now">When an opted-in guest&apos;s booking is worth less than what a waitlisted customer would pay (after compensation and fees), it appears here.</EmptyState> : (
        <ul className="space-y-5">{opps.map((o) => (
          <Card key={o.reservation_id} className="p-5"><div className="grid gap-6 lg:grid-cols-2"><div><Badge tone="gold">+{aud(o.quote.netBenefitCents)} net benefit</Badge><h3 className="mt-2 font-serif text-xl font-semibold">{o.title}</h3><p className="text-sm text-navy-900/70">{fmtDateTime(o.starts_at)} · booking {o.reference} at {aud(o.price_cents)}</p><div className="mt-4"><Quote q={o.quote} /></div></div>
            <ActionForm action={proposeBuybackAction} submit="Send offer to guest" variant="gold" className="h-fit space-y-3 rounded-xl border border-navy-900/15 p-4"><input type="hidden" name="reservationId" value={o.reservation_id} />
              <Field label="Compensation to guest ($)" htmlFor={`c-${o.reservation_id}`} hint="On top of a full refund."><Input id={`c-${o.reservation_id}`} name="compensation" inputMode="decimal" defaultValue={(o.suggestedCompensation / 100).toFixed(2)} /></Field>
              <Field label="Resale price to waitlisted customer ($)" htmlFor={`r-${o.reservation_id}`} hint={`Highest price a waitlisted customer will pay: ${aud(o.suggestedPrice)}`}><Input id={`r-${o.reservation_id}`} name="resalePrice" inputMode="decimal" defaultValue={(o.suggestedPrice / 100).toFixed(2)} /></Field>
              <Field label="Optional note to the guest" htmlFor={`n-${o.reservation_id}`}><Textarea id={`n-${o.reservation_id}`} name="note" rows={2} maxLength={400} /></Field></ActionForm></div></Card>))}</ul>)}

      <h2 className="mb-1 mt-10 text-xl font-semibold">Your proposals</h2>
      <p className="mb-3 text-sm text-navy-900/70">Guest acceptance rate: <strong>{Math.round(rate * 100)}%</strong> ({decided.length} decided of {offers.length}). {offers.length === 0 ? "" : `Realised net benefit: ${aud(offers.filter((o) => o.status === "completed").reduce((a, o) => a + o.net_benefit_cents, 0))}.`}</p>
      {offers.length === 0 ? <EmptyState title="No proposals yet" /> : <div className="card p-2"><Table><thead><tr><TH>Booking</TH><TH>Compensation</TH><TH>Resale</TH><TH>Net benefit</TH><TH>Status</TH><TH>Expires</TH></tr></thead><tbody>{offers.map((o) => <tr key={o.id}><TD>{o.title}<p className="font-mono text-xs text-navy-900/60">{o.reference}</p></TD><TD>{aud(o.compensation_cents)}</TD><TD>{aud(o.resale_price_cents)}</TD><TD>{aud(o.net_benefit_cents)}</TD><TD><StatusBadge status={o.status} />{o.requires_admin_approval && o.status === "pending_admin" && <p className="text-xs text-navy-900/60">awaiting admin</p>}</TD><TD className="text-xs">{["pending_customer", "pending_admin"].includes(o.status) ? fmtDateTime(o.expires_at) : "—"}</TD></tr>)}</tbody></Table></div>}
    </>
  );
}
