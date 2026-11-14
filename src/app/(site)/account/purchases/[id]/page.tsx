import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Download } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Countdown } from "@/components/countdown";
import { OrderTimeline } from "@/components/order-timeline";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { resaleRules, TRANSFER_LABEL } from "@/lib/domain/resale";
import { aud, fmtDateTime } from "@/lib/util";
import { cancelPurchaseAction, confirmReceiptAction, disputeAction, reviewSellerAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "Purchase" };

export default async function Purchase({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { id } = await params; const { paid } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requirePermission("customer:account", `/account/purchases/${id}`);
  const db = await getDb();
  const r = (await db.query<any>(
    `select r.*, l.title, l.starts_at, l.ends_at, l.transfer_method, l.id as lid, v.name as venue, v.address, v.suburb, v.transfer_instructions, sp.display_name as seller, pay.provider,
            (select id from resale_reviews where resale_order_id = r.id) as review_id, (select reason from resale_disputes where resale_order_id = r.id order by created_at desc limit 1) as dispute_reason
       from resale_orders r join resale_listings l on l.id = r.listing_id join venues v on v.id = l.venue_id join seller_profiles sp on sp.user_id = r.seller_id
       join payments pay on pay.order_id = r.order_id where r.id = $1`, [id])).rows[0];
  if (!r || r.buyer_id !== u.id) notFound();
  const rules = await resaleRules(db);
  const disputeUntil = new Date(new Date(r.starts_at).getTime() + rules.dispute_hours_after_start * 3_600_000);
  return (
    <>
      {paid && <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-4"><CheckCircle2 className="mt-0.5 size-5 text-success" /><div><p className="font-semibold text-success">Payment received — held in escrow</p><p className="text-sm">The seller has been notified and must deliver by <strong>{fmtDateTime(r.deliver_by)}</strong>, or you&apos;re refunded automatically.</p></div></div>}
      <PageHeader title={r.title} eyebrow={`Purchase ${r.reference}`}><StatusBadge status={r.status} />{r.provider === "sandbox" && <Badge tone="gold">Sandbox payment</Badge>}</PageHeader>
      <OrderTimeline status={r.status} />
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card><CardBody className="grid gap-4 p-5 sm:grid-cols-2">
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Venue</p><p className="font-medium">{r.venue}</p><p className="text-sm text-navy-900/70">{r.address}, {r.suburb}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">When</p><p className="font-medium">{fmtDateTime(r.starts_at)}</p><p className="text-sm text-navy-900/70">until {fmtDateTime(r.ends_at)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Seller</p><p className="font-medium"><Link href={`/sellers/${r.seller_id}`} className="hover:underline">{r.seller}</Link></p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Transfer</p><p className="font-medium">{TRANSFER_LABEL[r.transfer_method]} · {r.quantity} unit{r.quantity > 1 ? "s" : ""}</p></div>
          </CardBody></Card>

          {r.status === "paid" && (
            <Card><CardHeader><CardTitle>Waiting for the seller</CardTitle></CardHeader><CardBody>
              <p className="text-sm">They must deliver within <strong><Countdown to={new Date(r.deliver_by).toISOString()} /></strong>. You&apos;ll get a notification the moment they do. {r.transfer_instructions && <>Venue guidance: {r.transfer_instructions}</>}</p>
              <ActionForm action={cancelPurchaseAction} submit="Cancel and refund me" variant="outline" confirm="Cancel this purchase? You'll be refunded in full." className="mt-4 space-y-3"><input type="hidden" name="orderId" value={r.id} /><Field label="Reason (optional)" htmlFor="why"><Input id="why" name="reason" maxLength={300} /></Field></ActionForm>
              <p className="mt-2 text-xs text-navy-900/60">Free to cancel until the seller delivers.</p>
            </CardBody></Card>)}

          {["delivered", "disputed", "completed"].includes(r.status) && (
            <Card><CardHeader><CardTitle>What the seller sent</CardTitle></CardHeader><CardBody>
              <p className="whitespace-pre-line rounded-xl bg-ivory-100 p-4 text-sm">{r.delivery_notes ?? "(See attached file)"}</p>
              {r.delivery_file_name && <Button asChild variant="outline" size="sm" className="mt-3"><a href={`/api/resale/file/${r.id}`}><Download /> {r.delivery_file_name}</a></Button>}
              <p className="mt-3 text-xs text-navy-900/60">Delivered {fmtDateTime(r.delivered_at)}.</p>
            </CardBody></Card>)}

          {r.status === "delivered" && (
            <div className="grid gap-6 md:grid-cols-2">
              <Card><CardHeader><CardTitle>All good?</CardTitle></CardHeader><CardBody><p className="mb-3 text-sm text-navy-900/75">Confirming releases the money to the seller. If you do nothing, it releases automatically {fmtDateTime(r.auto_release_at)} unless you report a problem.</p>
                <ActionForm action={confirmReceiptAction} submit="Confirm — release payment" variant="gold" confirm="Release the payment to the seller?"><input type="hidden" name="orderId" value={r.id} /></ActionForm></CardBody></Card>
              <Card><CardHeader><CardTitle>Something wrong?</CardTitle></CardHeader><CardBody>
                <ActionForm action={disputeAction} submit="Report a problem" variant="outline" className="space-y-3"><input type="hidden" name="orderId" value={r.id} />
                  <Field label="What's the problem?" htmlFor="reason"><Select id="reason" name="reason"><option>Details don't work / invalid</option><option>Not as described</option><option>Booking already used or cancelled</option><option>Seller isn&apos;t responding</option><option>Other</option></Select></Field>
                  <Field label="Details" htmlFor="details"><Textarea id="details" name="details" rows={3} maxLength={1500} /></Field></ActionForm>
                <p className="mt-2 text-xs text-navy-900/60">Your money stays frozen while we review. You can report until {fmtDateTime(disputeUntil)}.</p></CardBody></Card>
            </div>)}

          {r.status === "disputed" && <Card className="border-gold-500/40 bg-gold-300/10 p-5 text-sm"><p className="font-semibold">Under review</p><p className="mt-1">You reported: “{r.dispute_reason}”. Your payment stays in escrow until we decide. We&apos;ll notify you either way.</p></Card>}
          {r.status === "completed" && !r.review_id && (
            <Card><CardHeader><CardTitle>Review {r.seller}</CardTitle></CardHeader><CardBody><ActionForm action={reviewSellerAction} submit="Post review" className="space-y-3"><input type="hidden" name="orderId" value={r.id} />
              <Field label="Rating" htmlFor="rating"><Select id="rating" name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}</Select></Field>
              <Field label="Comment" htmlFor="comment"><Textarea id="comment" name="comment" maxLength={1000} /></Field></ActionForm></CardBody></Card>)}
          {["refunded", "cancelled", "refunding"].includes(r.status) && <Card className="p-5 text-sm"><p className="font-semibold">{r.status === "refunding" ? "Refund in progress" : "Refunded in full"}</p><p className="mt-1">{aud(r.total_cents)} (including the service fee) {r.status === "refunding" ? "is being returned" : "was returned"} to your original payment method. {r.cancel_reason}</p></Card>}
        </div>
        <aside><Card className="p-5">
          <PriceBreakdown rows={[{ label: r.quantity > 1 ? `${r.quantity} × ${aud(r.unit_price_cents)}` : "Price", cents: r.subtotal_cents }, { label: "Service fee", cents: r.buyer_fee_cents }]} total={r.total_cents} gstCents={Math.round(r.buyer_fee_cents / 11)} note="The item is a private sale." />
          {r.status !== "pending_payment" && <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link href={`/account/purchases/${r.id}/receipt`}>View receipt</Link></Button>}
        </Card></aside>
      </div>
    </>
  );
}
