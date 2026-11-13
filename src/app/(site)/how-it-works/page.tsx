import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WAITLIST_POLICY_TEXT } from "@/lib/domain/waitlist";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorks() {
  const steps = [["Discover", "Browse verified last-minute rooms, tables and tickets by date, price, rating and location. Prices already include every mandatory fee — you see the total before you pay."], ["Book securely", "Your place is held for 10 minutes while you pay by card, Apple Pay or Google Pay. The payment is authorised first and only captured once your place is confirmed — so you can never be charged for something you didn't get."], ["Enjoy — or change your mind", "Every listing shows its cancellation terms up front. Eligible cancellations are refunded automatically to your original payment method."]];
  return (
    <div className="container-page max-w-4xl py-12">
      <p className="eyebrow">How it works</p><h1 className="mt-1 text-4xl font-semibold">Last-minute, done honestly.</h1>
      <ol className="mt-8 space-y-4">{steps.map(([t, d], i) => <li key={t} className="card flex gap-4 p-5"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-900 font-serif text-lg text-gold-300">{i + 1}</span><div><h2 className="text-xl font-semibold">{t}</h2><p className="mt-1 text-navy-900/75">{d}</p></div></li>)}</ol>

      <h2 className="mt-14 text-3xl font-semibold">Sold out? The fair waitlist</h2>
      <div className="mt-4 space-y-4 text-navy-900/80">
        <p>Join the waitlist for any sold-out room, table or event. Tell us the most you&apos;d pay (optional), your preferred times, and how you&apos;d like to be notified. When a place opens — because someone cancelled, or the venue released more — you get an offer with a countdown. Accept and pay in time and it&apos;s yours; otherwise it passes to the next person.</p>
        <div className="card p-5"><h3 className="text-lg font-semibold">How priority is decided</h3><p className="mt-2 text-sm">Each venue chooses one of two published policies and shows it on every sold-out listing:</p>
          <ul className="mt-2 space-y-2 text-sm"><li><strong>First come, first served.</strong> {WAITLIST_POLICY_TEXT.first_come}</li><li><strong>Highest offer first.</strong> {WAITLIST_POLICY_TEXT.highest_offer}</li></ul></div>
        <p className="text-sm text-navy-900/70">Transparent pricing: you only ever pay the offer price you&apos;re shown — never your maximum — plus the same mandatory service fee as any booking.</p>
      </div>

      <h2 className="mt-14 text-3xl font-semibold">Optional venue offers on confirmed bookings</h2>
      <div className="mt-4 space-y-3 text-navy-900/80">
        <p>When demand spikes, a venue may <em>ask</em> a guest whether they&apos;d like to release their booking. This only ever happens if you opted in when you booked, and only through a specific offer showing exactly what you&apos;d receive: <strong>a full refund of everything you paid plus extra compensation</strong>.</p>
        <ul className="list-disc space-y-1 pl-6 text-sm"><li>Your booking is <strong>never</strong> cancelled just because someone else offers more money.</li><li>You can say no, or ignore the offer, with no penalty — your booking stays exactly as it is.</li><li>If you accept, your booking is cancelled, the refund and compensation are processed, and only then is the place released.</li><li>Tickets for events are subject to a legal resale price cap.</li><li><strong>Registered partners only:</strong> this only ever applies to inventory sold on Eleventh Hour by a verified, approved partner. Nothing bought elsewhere can be resold here.</li></ul>
        <p className="rounded-xl bg-gold-300/20 p-4 text-sm"><strong>Status:</strong> this feature is switched off platform-wide until our legal review under the Australian Consumer Law and state ticketing laws is complete. When it&apos;s on, you&apos;ll see an unticked opt-in box at checkout.</p>
      </div>
      <div className="mt-10 flex gap-3"><Button asChild size="lg"><Link href="/search">Find something tonight</Link></Button><Button asChild size="lg" variant="outline"><Link href="/partners">I run a venue</Link></Button></div>
    </div>
  );
}
