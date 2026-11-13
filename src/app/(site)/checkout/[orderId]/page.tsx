import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Countdown } from "@/components/countdown";
import { PriceBreakdown } from "@/components/price-breakdown";
import { StripePay } from "@/components/stripe-pay";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getOrderView } from "@/lib/domain/booking";
import { POLICY_LABEL, policyText, type CancellationPolicy } from "@/lib/domain/policies";
import { aud, fmtDateTime } from "@/lib/util";
import { abandonCheckoutAction, payAction } from "@/app/actions/booking";

export const metadata: Metadata = { title: "Secure checkout" };

export default async function Checkout({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const user = await requireUser(`/checkout/${orderId}`);
  const o = await getOrderView(orderId);
  if (!o || o.customer_id !== user.id) notFound();
  if (o.status === "paid") redirect(`/account/bookings/${o.items[0].id}?confirmed=1`);
  const first = o.items[0];
  const expired = o.status !== "pending_payment" || new Date(o.expires_at) <= new Date();
  const processing = o.payment_status === "authorized";
  const gst = o.items.reduce((a: number, r: any) => a + r.gst_cents, 0) + Math.round(o.customer_fee_cents / 11);

  return (
    <div className="container-page max-w-5xl py-10">
      <h1 className="text-3xl font-semibold">Secure checkout</h1>
      <div className="mt-6 grid gap-8 md:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {expired ? (
            <Card className="p-6"><h2 className="text-xl font-semibold">This checkout has expired</h2><p className="mt-2 text-sm text-navy-900/70">Your hold was released so others can book. Nothing was charged.</p><Button asChild className="mt-4"><Link href={`/listings/${first.listing_id}`}>Back to the listing</Link></Button></Card>
          ) : processing ? (
            <Card className="p-6"><meta httpEquiv="refresh" content="3" /><h2 className="text-xl font-semibold">Confirming your payment…</h2><p className="mt-2 text-sm text-navy-900/70">This usually takes a few seconds. This page will update automatically.</p></Card>
          ) : (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="size-4 text-gold-600" />Payment</CardTitle>
                <p className="text-sm text-navy-900/70">Your {o.items.length > 1 ? "items are" : "item is"} held for <strong><Countdown to={new Date(o.expires_at).toISOString()} /></strong>.</p></CardHeader>
              <CardBody>
                {o.provider === "sandbox" ? (
                  <ActionForm action={payAction} submit={`Pay ${aud(o.total_cents)} (test)`} variant="gold" size="lg" submitClassName="w-full" className="space-y-4">
                    <div className="rounded-xl border border-gold-500/40 bg-gold-300/20 p-3 text-sm"><Badge tone="gold">TEST MODE</Badge> <span className="ml-1">No real money moves. Use a Stripe test card: <code className="font-mono">4242 4242 4242 4242</code> succeeds · <code className="font-mono">4000 0000 0000 0002</code> is declined · <code className="font-mono">4000 0000 0000 9995</code> insufficient funds.</span></div>
                    <input type="hidden" name="orderId" value={o.id} />
                    <Field label="Card number" htmlFor="cardNumber"><Input id="cardNumber" name="cardNumber" inputMode="numeric" autoComplete="cc-number" defaultValue="4242 4242 4242 4242" /></Field>
                    <div className="grid grid-cols-2 gap-3"><Field label="Expiry" htmlFor="exp"><Input id="exp" name="exp" defaultValue="12 / 34" autoComplete="cc-exp" /></Field><Field label="CVC" htmlFor="cvc"><Input id="cvc" name="cvc" defaultValue="123" autoComplete="cc-csc" /></Field></div>
                    <div className="grid grid-cols-2 gap-3"><Button type="button" variant="outline" disabled title="Available with live Stripe">Apple Pay</Button><Button type="button" variant="outline" disabled title="Available with live Stripe">Google Pay</Button></div>
                    <p className="text-xs text-navy-900/60">Apple Pay and Google Pay are enabled automatically when Stripe is connected and the customer&apos;s device supports them.</p>
                  </ActionForm>
                ) : o.client_secret ? <StripePay clientSecret={o.client_secret} orderId={o.id} totalLabel={aud(o.total_cents)} /> : <p className="text-sm text-danger">Payment is not ready. Please refresh.</p>}
                {o.failure_reason && <p role="alert" className="mt-3 text-sm text-danger">Last attempt: {o.failure_reason}</p>}
              </CardBody>
            </Card>
          )}
          <Card className="p-5"><h2 className="font-serif text-lg font-semibold">{POLICY_LABEL[first.cancellation_policy as CancellationPolicy]}</h2><p className="mt-1 text-sm text-navy-900/80">{policyText(first.cancellation_policy as CancellationPolicy)}</p></Card>
        </div>
        <aside aria-label="Order summary"><Card className="sticky top-24 p-5">
          <p className="eyebrow">Order {o.reference}</p>
          {o.source !== "direct" && <p className="mt-1"><Badge tone="gold">{o.source === "buyback" ? "Released place — offer price" : "Waitlist offer price"}</Badge></p>}
          <h2 className="mt-2 font-serif text-xl font-semibold">{first.title}</h2>
          <p className="text-sm text-navy-900/70">{first.venue_name} · {first.suburb}</p>
          <p className="mt-1 text-sm">{fmtDateTime(first.starts_at)}</p>
          <ul className="mt-3 text-sm text-navy-900/70">{o.items.map((r: any) => <li key={r.id}>{r.label} · {r.guests} guest{r.guests > 1 ? "s" : ""}</li>)}</ul>
          <hr className="my-4 border-navy-900/10" />
          <PriceBreakdown rows={[{ label: o.items.length > 1 ? `${o.items.length} × ${aud(first.price_cents)}` : "Price", cents: o.subtotal_cents }, { label: "Service fee", cents: o.customer_fee_cents, hint: "Mandatory platform fee" }]} total={o.total_cents} gstCents={gst} />
          {!expired && <form action={abandonCheckoutAction} className="mt-4"><input type="hidden" name="orderId" value={o.id} /><Button variant="ghost" size="sm" className="w-full">Cancel and release hold</Button></form>}
        </Card></aside>
      </div>
    </div>
  );
}
