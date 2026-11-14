import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Countdown } from "@/components/countdown";
import { PriceBreakdown } from "@/components/price-breakdown";
import { StripePay } from "@/components/stripe-pay";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";
import { abandonResaleCheckoutAction, payResaleAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "Secure payment" };

export default async function Pay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser(`/pay/${id}`);
  const o = (await (await getDb()).query<any>(
    `select r.*, o.expires_at, o.status as order_status, p.provider, p.client_secret, p.failure_reason, p.status as pay_status, l.title, l.starts_at, l.id as lid, v.name as venue, v.suburb, sp.display_name as seller_name
       from resale_orders r join orders o on o.id = r.order_id join payments p on p.order_id = o.id join resale_listings l on l.id = r.listing_id join venues v on v.id = l.venue_id
       join seller_profiles sp on sp.user_id = r.seller_id where r.id = $1`, [id])).rows[0];
  if (!o || o.buyer_id !== user.id) notFound();
  if (o.status !== "pending_payment" && o.status !== "expired") redirect(`/account/purchases/${o.id}`);
  const expired = o.status !== "pending_payment" || new Date(o.expires_at) <= new Date();
  return (
    <div className="container-page max-w-5xl py-10">
      <p className="eyebrow">Escrow checkout</p><h1 className="h-section mt-2">Pay securely</h1>
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {expired ? (
            <Card className="p-6"><h2 className="text-xl">This checkout has expired</h2><p className="mt-2 text-sm text-navy-900/70">The hold was released so others can buy. Nothing was charged.</p><Button asChild className="mt-4"><Link href={`/resale/${o.lid}`}>Back to the listing</Link></Button></Card>
          ) : o.pay_status === "authorized" ? (
            <Card className="p-6"><meta httpEquiv="refresh" content="3" /><h2 className="text-xl">Confirming your payment…</h2><p className="mt-2 text-sm text-navy-900/70">This page updates automatically.</p></Card>
          ) : (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="size-4 text-gold-700" />Payment</CardTitle><p className="text-sm text-navy-900/70">Held for <strong><Countdown to={new Date(o.expires_at).toISOString()} /></strong>.</p></CardHeader>
              <CardBody>
                {o.provider === "sandbox" ? (
                  <ActionForm action={payResaleAction} submit={`Pay ${aud(o.total_cents)} (test)`} variant="gold" size="lg" submitClassName="w-full" className="space-y-4">
                    <div className="rounded-xl border border-gold-500/40 bg-gold-300/20 p-3 text-sm"><Badge tone="gold">TEST MODE</Badge> <span className="ml-1">No real money moves. Stripe test card <code className="font-mono">4242 4242 4242 4242</code> succeeds · <code className="font-mono">4000 0000 0000 0002</code> is declined.</span></div>
                    <input type="hidden" name="resaleOrderId" value={o.id} />
                    <Field label="Card number" htmlFor="cardNumber"><Input id="cardNumber" name="cardNumber" inputMode="numeric" autoComplete="cc-number" defaultValue="4242 4242 4242 4242" /></Field>
                    <div className="grid grid-cols-2 gap-3"><Field label="Expiry" htmlFor="exp"><Input id="exp" name="exp" defaultValue="12 / 34" autoComplete="cc-exp" /></Field><Field label="CVC" htmlFor="cvc"><Input id="cvc" name="cvc" defaultValue="123" autoComplete="cc-csc" /></Field></div>
                  </ActionForm>
                ) : o.client_secret ? <StripePay clientSecret={o.client_secret} orderId={o.id} totalLabel={aud(o.total_cents)} /> : <p className="text-sm text-danger">Payment isn&apos;t ready. Please refresh.</p>}
                {o.failure_reason && <p role="alert" className="mt-3 text-sm text-danger">Last attempt: {o.failure_reason}</p>}
              </CardBody>
            </Card>
          )}
          <Card className="flex gap-3 p-5 text-sm"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-700" /><p><strong>Your money is protected.</strong> The seller is not paid until you confirm delivery (or {" "}24h after the event with no problem). If they don&apos;t deliver by the deadline you&apos;re refunded automatically.</p></Card>
        </div>
        <aside aria-label="Order summary"><Card className="sticky top-28 p-6">
          <p className="eyebrow">Order {o.reference}</p>
          <h2 className="mt-2 text-xl">{o.title}</h2><p className="text-sm text-navy-900/70">{o.venue} · {o.suburb}</p><p className="mt-1 text-sm">{fmtDateTime(o.starts_at)} · sold by {o.seller_name}</p>
          <hr className="my-4 border-navy-900/10" />
          <PriceBreakdown rows={[{ label: o.quantity > 1 ? `${o.quantity} × ${aud(o.unit_price_cents)}` : "Price", cents: o.subtotal_cents }, { label: "Service fee", cents: o.buyer_fee_cents, hint: "Buyer protection · includes GST" }]} total={o.total_cents} gstCents={Math.round(o.buyer_fee_cents / 11)} note="The item itself is a private sale." />
          {!expired && <form action={abandonResaleCheckoutAction} className="mt-4"><input type="hidden" name="resaleOrderId" value={o.id} /><Button variant="ghost" size="sm" className="w-full">Cancel and release</Button></form>}
        </Card></aside>
      </div>
    </div>
  );
}
