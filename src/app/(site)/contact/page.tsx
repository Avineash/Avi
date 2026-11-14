import type { Metadata } from "next";
import Link from "next/link";
import { isFull } from "@/lib/phase";
export const metadata: Metadata = { title: "Contact & support" };
export default function Contact() {
  return (
    <div className="container-page max-w-3xl py-12">
      <p className="eyebrow">Support</p><h1 className="mt-1 text-4xl font-semibold">We&apos;re here to help</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card p-5"><h2 className="text-lg font-semibold">Buyers</h2><p className="mt-1 text-sm text-navy-900/75">{isFull() ? <>Open the booking in <Link className="underline" href="/account/bookings">your account</Link> and use “Request an exceptional refund”, or email </> : <>Problem with a purchase? Open it in <Link className="underline" href="/account/purchases">your purchases</Link> and report it — your money stays frozen while we review. Or email </>}<span className="font-mono">support@your-domain.example</span>.</p></div>
        {isFull() ? <div className="card p-5"><h2 className="text-lg font-semibold">Partners</h2><p className="mt-1 text-sm text-navy-900/75">Questions about onboarding, payouts or integrations: <span className="font-mono">partners@your-domain.example</span>.</p></div> : <div className="card p-5"><h2 className="text-lg font-semibold">Sellers</h2><p className="mt-1 text-sm text-navy-900/75">Questions about listings, deliveries or payouts: <span className="font-mono">sellers@your-domain.example</span>.</p></div>}
      </div>
      <p className="mt-6 text-sm text-navy-900/60">Replace these placeholder addresses with your monitored support inboxes before launch. Urgent day-of-stay issues should be raised with the venue directly using the contact details in your booking.</p>
    </div>
  );
}
