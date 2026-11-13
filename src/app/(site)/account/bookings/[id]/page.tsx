import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { POLICY_LABEL, hoursUntil, policyText, refundBps, type CancellationPolicy } from "@/lib/domain/policies";
import { aud, fmtDateTime } from "@/lib/util";
import { cancelBookingAction, requestRefundAction, submitReviewAction } from "@/app/actions/account";

export const metadata: Metadata = { title: "Booking details" };

export default async function BookingDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmed?: string }> }) {
  const { id } = await params; const { confirmed } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requirePermission("customer:account", `/account/bookings/${id}`);
  const db = await getDb();
  const r = (await db.query<any>(
    `select r.*, l.title, l.starts_at, l.ends_at, l.category, l.subcategory, v.name as venue, v.address, v.suburb, p.business_name, pay.provider, pay.status as pay_status, pay.id as payment_id,
            (select id from reviews where reservation_id = r.id) as review_id, u.label as unit_label
       from reservations r join listings l on l.id = r.listing_id join venues v on v.id = l.venue_id join partners p on p.id = r.partner_id
       join payments pay on pay.order_id = r.order_id join inventory_units u on u.id = r.unit_id where r.id = $1`, [id])).rows[0];
  if (!r || r.customer_id !== u.id) notFound();
  const refunds = (await db.query<any>("select * from refunds where reservation_id = $1 order by created_at", [id])).rows;
  const offers = (await db.query<any>("select * from buyback_offers where reservation_id = $1 order by created_at desc", [id])).rows;
  const hrs = hoursUntil(r.starts_at);
  const refundNow = Math.round((r.total_cents * refundBps(r.cancellation_policy as CancellationPolicy, hrs)) / 10_000);
  const canCancel = r.status === "confirmed" && hrs > 0;
  const refunded = refunds.filter((x) => x.status === "succeeded").reduce((a, x) => a + x.amount_cents, 0);

  return (
    <>
      {confirmed && <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-4"><CheckCircle2 className="mt-0.5 size-5 text-success" /><div><p className="font-semibold text-success">Booking confirmed</p><p className="text-sm">We&apos;ve emailed your confirmation. Reference <strong>{r.reference}</strong>.</p></div></div>}
      <PageHeader title={r.title} eyebrow={`Booking ${r.reference}`}><StatusBadge status={r.status} />{r.provider === "sandbox" && <Badge tone="gold">Sandbox payment</Badge>}</PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card><CardBody className="grid gap-4 p-5 sm:grid-cols-2">
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Venue</p><p className="font-medium">{r.venue}</p><p className="text-sm text-navy-900/70">{r.address}, {r.suburb}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">When</p><p className="font-medium">{fmtDateTime(r.starts_at)}</p><p className="text-sm text-navy-900/70">until {fmtDateTime(r.ends_at)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Guest</p><p className="font-medium">{r.guest_name} · {r.guests} guest{r.guests > 1 ? "s" : ""}</p><p className="text-sm text-navy-900/70">{r.unit_label}{r.special_requests ? ` · “${r.special_requests}”` : ""}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Provided by</p><p className="font-medium">{r.business_name}</p></div>
          </CardBody></Card>

          <Card><CardHeader><CardTitle>Cancellation &amp; refund</CardTitle></CardHeader><CardBody>
            <p className="font-medium">{POLICY_LABEL[r.cancellation_policy as CancellationPolicy]}</p>
            <p className="text-sm text-navy-900/75">{policyText(r.cancellation_policy as CancellationPolicy)}</p>
            {canCancel && (
              <ActionForm action={cancelBookingAction} submit="Cancel this booking" variant="danger" confirm={`Cancel this booking? ${refundNow > 0 ? `You'll be refunded ${aud(refundNow)}.` : "You will not receive a refund."}`} className="mt-4 space-y-3">
                <input type="hidden" name="reservationId" value={r.id} />
                <div className="rounded-xl bg-ivory-100 p-3 text-sm">If you cancel now you&apos;ll receive <strong>{aud(refundNow)}</strong> {refundNow === r.total_cents ? "(a full refund including the service fee)" : refundNow > 0 ? `(${Math.round((refundNow / r.total_cents) * 100)}% of ${aud(r.total_cents)})` : "— this booking is no longer refundable for change of mind"}.</div>
                <Field label="Reason (optional)" htmlFor="reason"><Input id="reason" name="reason" maxLength={300} /></Field>
              </ActionForm>
            )}
            {r.status !== "pending_payment" && r.status !== "expired" && (
              <details className="mt-5 rounded-xl border border-navy-900/15 p-4"><summary className="cursor-pointer text-sm font-semibold">Something went wrong? Request an exceptional refund</summary>
                <p className="mt-2 text-xs text-navy-900/60">Reviewed by our team. This is in addition to — not instead of — your rights under the Australian Consumer Law.</p>
                <ActionForm action={requestRefundAction} submit="Send request" variant="outline" className="mt-3 space-y-3">
                  <input type="hidden" name="reservationId" value={r.id} />
                  <Field label="Amount requested (AUD)" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" defaultValue={(r.total_cents / 100).toFixed(2)} /></Field>
                  <Field label="What happened?" htmlFor="why"><Textarea id="why" name="reason" required minLength={10} /></Field>
                </ActionForm>
              </details>)}
          </CardBody></Card>

          {r.status === "completed" && !r.review_id && (
            <Card><CardHeader><CardTitle>Leave a verified review</CardTitle></CardHeader><CardBody>
              <ActionForm action={submitReviewAction} submit="Post review" className="space-y-3"><input type="hidden" name="reservationId" value={r.id} />
                <Field label="Rating" htmlFor="rating"><Select id="rating" name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}</Select></Field>
                <Field label="Comment" htmlFor="comment"><Textarea id="comment" name="comment" maxLength={1500} /></Field></ActionForm>
            </CardBody></Card>)}

          {offers.length > 0 && <Card><CardHeader><CardTitle>Venue offers on this booking</CardTitle></CardHeader><CardBody><ul className="space-y-2 text-sm">{offers.map((o) => <li key={o.id} className="flex items-center justify-between"><span>Optional offer: refund + {aud(o.compensation_cents)} compensation</span><StatusBadge status={o.status} /></li>)}</ul></CardBody></Card>}
        </div>
        <aside className="space-y-6">
          <Card><CardHeader><CardTitle>Payment</CardTitle></CardHeader><CardBody>
            <PriceBreakdown rows={[{ label: "Price", cents: r.price_cents }, { label: "Service fee", cents: r.customer_fee_cents }]} total={r.total_cents} gstCents={r.gst_cents + Math.round(r.customer_fee_cents / 11)} />
            {refunds.length > 0 && <div className="mt-4 border-t border-navy-900/10 pt-3 text-sm"><p className="font-medium">Refunds</p><ul className="mt-1 space-y-1">{refunds.map((f) => <li key={f.id} className="flex justify-between"><span className="capitalize">{f.kind} · <StatusBadge status={f.status} /></span><span>{aud(f.amount_cents)}</span></li>)}</ul>{refunded > 0 && <p className="mt-2 text-xs text-navy-900/60">Returned to your original payment method; banks can take 5–10 business days to show it.</p>}</div>}
            {r.status !== "pending_payment" && r.status !== "expired" && <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link href={`/account/bookings/${r.id}/invoice`}>View tax invoice</Link></Button>}
          </CardBody></Card>
        </aside>
      </div>
    </>
  );
}
