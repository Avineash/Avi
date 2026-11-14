import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WAITLIST_POLICY_TEXT } from "@/lib/domain/waitlist";
import { isFull } from "@/lib/phase";
import { getDb } from "@/lib/db";
import { resaleRules } from "@/lib/domain/resale";

export const metadata: Metadata = { title: "How it works" };

function FullHowItWorks() {
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

async function MarketHowItWorks() {
  const r = await resaleRules(await getDb());
  const box = (t: string, d: string) => <li key={t} className="card p-5"><h3 className="text-lg">{t}</h3><p className="mt-1 text-sm text-navy-900/75">{d}</p></li>;
  return (
    <div className="container-page max-w-4xl py-12">
      <p className="eyebrow">How it works</p><h1 className="h-section mt-3">Buying and selling, <em>made safe.</em></h1>
      <p className="mt-5 max-w-2xl text-lg text-navy-900/75">Eleventh Hour is a marketplace where people pass on hotel stays, dining reservations and event tickets they can no longer use. We hold the money in escrow so neither side has to trust a stranger.</p>

      <h2 className="mt-14 text-3xl">If you&apos;re buying</h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2">
        {box("1 · Find it", "Search by date, price, venue and seller rating. Every listing shows what the seller originally paid and your all-in price, fees included.")}
        {box("2 · Pay into escrow", `You pay Eleventh Hour. The listing is held for ${r.hold_minutes} minutes while you pay. The seller is not paid yet.`)}
        {box("3 · The seller delivers", `They have ${r.delivery_hours} hours (and must finish before the event) to transfer it and send you the details. Miss the deadline and you're refunded automatically, in full.`)}
        {box("4 · You confirm", `Check the details and confirm — or do nothing and the money releases ${r.release_after_start_hours}h after the event starts, unless you report a problem. Problem? Report it and the funds stay frozen while we review.`)}
      </ol>
      <p className="mt-4 text-sm text-navy-900/70">You can cancel for a full refund (including our fee) any time before the seller delivers. Once delivered, the sale is final unless something is wrong. Your rights under the Australian Consumer Law always apply.</p>

      <h2 className="mt-14 text-3xl">If you&apos;re selling</h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2">
        {box("1 · Set up", "A public name and a mobile number, once. Accept the Seller Terms.")}
        {box("2 · List it", "Pick a registered venue, add the booking details, proof of purchase and your price — within the venue's resale cap.")}
        {box("3 · Deliver", "When it sells, transfer it (name change, ticket transfer, voucher…) and confirm the details in your sale page.")}
        {box("4 · Get paid", "Released to your balance when the buyer confirms, or automatically after the event. Withdraw any time. You pay a fee only when you sell.")}
      </ol>
      <p className="mt-4 text-sm text-navy-900/70">Failing to deliver, or cancelling a paid sale, refunds the buyer and adds a strike to your account. {r.max_strikes} strikes suspends selling.</p>

      <h2 className="mt-14 text-3xl">The rules that keep it fair</h2>
      <ul className="mt-5 space-y-3 text-navy-900/80">
        <li className="card p-5"><strong>Registered venues only.</strong> Resale is only possible for venues registered with Eleventh Hour. Something bought elsewhere, or at an unregistered venue, can&apos;t be listed here.</li>
        <li className="card p-5"><strong>Price caps.</strong> Each venue sets how far above the original price a resale may go — hotels and restaurants at face value or below, event tickets up to a capped markup (110% by default).</li>
        <li className="card p-5"><strong>No double listings.</strong> The same booking reference can only be listed once at a time.</li>
        <li className="card p-5"><strong>What we don&apos;t do (yet).</strong> Venues don&apos;t confirm transfers on the platform today, so proof of purchase is declared by the seller and held on file. That&apos;s why your payment stays in escrow and every problem path ends in a refund.</li>
      </ul>
      <div className="mt-10 flex gap-3"><Button asChild size="lg"><Link href="/search">Browse listings</Link></Button><Button asChild size="lg" variant="gold"><Link href="/sell">Sell a booking</Link></Button></div>
    </div>
  );
}

export default async function HowItWorks() { return isFull() ? <FullHowItWorks /> : <MarketHowItWorks />; }
