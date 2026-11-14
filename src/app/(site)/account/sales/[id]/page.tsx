import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Countdown } from "@/components/countdown";
import { OrderTimeline } from "@/components/order-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, StatusBadge, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { TRANSFER_LABEL } from "@/lib/domain/resale";
import { aud, fmtDateTime } from "@/lib/util";
import { cancelSaleAction, deliverAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "Sale" };

export default async function Sale({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requirePermission("customer:account", `/account/sales/${id}`);
  const r = (await (await getDb()).query<any>(
    `select r.*, l.title, l.starts_at, l.transfer_method, l.transfer_notes, l.booking_reference, v.name as venue, v.transfer_instructions, bu.name as buyer_name
       from resale_orders r join resale_listings l on l.id = r.listing_id join venues v on v.id = l.venue_id join users bu on bu.id = r.buyer_id where r.id = $1`, [id])).rows[0];
  if (!r || r.seller_id !== u.id) notFound();
  const net = r.subtotal_cents - r.seller_fee_cents;
  return (
    <>
      <PageHeader title={r.title} eyebrow={`Sale ${r.reference}`}><StatusBadge status={r.status} /></PageHeader>
      <OrderTimeline status={r.status} />
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card><CardBody className="grid gap-4 p-5 sm:grid-cols-2">
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Buyer</p><p className="font-medium">{r.buyer_name.split(" ")[0]} {r.buyer_name.split(" ")[1]?.[0] ?? ""}.</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Quantity</p><p className="font-medium">{r.quantity}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Booking</p><p className="font-medium">{r.venue}</p><p className="text-sm text-navy-900/70">{fmtDateTime(r.starts_at)} · ref {r.booking_reference}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Transfer</p><p className="font-medium">{TRANSFER_LABEL[r.transfer_method]}</p>{r.transfer_instructions && <p className="text-sm text-navy-900/70">{r.transfer_instructions}</p>}</div>
          </CardBody></Card>
          {r.status === "paid" && (
            <>
              <Card className="border-gold-500/50"><CardHeader><CardTitle>Deliver to the buyer</CardTitle><p className="text-sm text-navy-900/70">Deadline in <strong className="text-danger"><Countdown to={new Date(r.deliver_by).toISOString()} /></strong> ({fmtDateTime(r.deliver_by)}). Miss it and the buyer is refunded automatically and you get a strike.</p></CardHeader><CardBody>
                <ActionForm action={deliverAction} submit="Mark as delivered" variant="gold" size="lg" className="space-y-4"><input type="hidden" name="orderId" value={r.id} />
                  <Field label="Transfer details for the buyer" htmlFor="notes" hint="e.g. name changed on the booking, new confirmation number, how they check in."><Textarea id="notes" name="notes" rows={4} maxLength={1500} required /></Field>
                  <Field label="Attach the transferred ticket / confirmation (optional)" htmlFor="file" hint="PDF, PNG or JPEG, max 5 MB."><Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="py-2" /></Field></ActionForm>
              </CardBody></Card>
              <Card><CardHeader><CardTitle>Can&apos;t deliver?</CardTitle></CardHeader><CardBody><ActionForm action={cancelSaleAction} submit="Cancel this sale" variant="danger" confirm="Cancel the sale? The buyer is refunded in full and you receive a strike." className="space-y-3"><input type="hidden" name="orderId" value={r.id} /><Field label="Reason" htmlFor="reason"><Input id="reason" name="reason" maxLength={300} /></Field></ActionForm></CardBody></Card>
            </>)}
          {r.status === "delivered" && <Card className="p-5 text-sm"><p className="font-semibold">Waiting for the buyer</p><p className="mt-1">You&apos;re paid when they confirm — or automatically {fmtDateTime(r.auto_release_at)} if no problem is reported.</p>{r.delivery_file_name && <Button asChild variant="outline" size="sm" className="mt-3"><a href={`/api/resale/file/${r.id}`}><Download /> {r.delivery_file_name}</a></Button>}</Card>}
          {r.status === "disputed" && <Card className="border-gold-500/40 bg-gold-300/10 p-5 text-sm"><p className="font-semibold">The buyer reported a problem</p><p className="mt-1">The funds are frozen while we review. We may contact you on the mobile number in your profile.</p></Card>}
          {r.status === "completed" && <Card className="p-5 text-sm"><p className="font-semibold text-success">Complete — {aud(net)} released to your balance.</p></Card>}
          {["refunded", "cancelled", "refunding"].includes(r.status) && <Card className="p-5 text-sm"><p className="font-semibold">Sale {r.status === "refunding" ? "being cancelled" : "cancelled"}</p><p className="mt-1">{r.cancel_reason}{r.strike_applied ? " A strike was recorded." : ""}</p></Card>}
        </div>
        <aside><Card className="p-5"><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-navy-900/70">Sale price</dt><dd className="tabular-nums">{aud(r.subtotal_cents)}</dd></div><div className="flex justify-between"><dt className="text-navy-900/70">Seller fee</dt><dd className="tabular-nums">−{aud(r.seller_fee_cents)}</dd></div><div className="flex justify-between border-t border-navy-900/15 pt-2 text-base font-semibold"><dt>You receive</dt><dd className="tabular-nums">{aud(net)}</dd></div></dl></Card></aside>
      </div>
    </>
  );
}
