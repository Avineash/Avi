"use client";
import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = pk ? loadStripe(pk) : null;

function Inner({ orderId, totalLabel }: { orderId: string; totalLabel: string }) {
  const stripe = useStripe(); const elements = useElements();
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); if (!stripe || !elements) return; setBusy(true); setErr(null);
      const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/checkout/${orderId}` } });
      if (error) setErr(error.message ?? "Payment failed"); setBusy(false);
    }} className="space-y-4">
      <PaymentElement /> {/* cards, Apple Pay and Google Pay appear automatically where the device supports them */}
      <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy || !stripe}>{busy ? "Processing…" : `Pay ${totalLabel}`}</Button>
      {err && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
    </form>
  );
}
export function StripePay({ clientSecret, orderId, totalLabel }: { clientSecret: string; orderId: string; totalLabel: string }) {
  if (!stripePromise) return <p className="text-sm text-danger">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.</p>;
  return <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#0b1b33" } } }}><Inner orderId={orderId} totalLabel={totalLabel} /></Elements>;
}
