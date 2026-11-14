import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Banknote, Lock, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { describeRule } from "@/lib/domain/fees";
import { featureOn } from "@/lib/domain/settings";
import { getSeller, resaleRules } from "@/lib/domain/resale";

export const metadata: Metadata = { title: "Sell a booking or ticket" };

export default async function Sell() {
  const user = await getUser();
  const db = await getDb();
  const seller = user ? await getSeller(db, user.id) : null;
  const rule = (await db.query<any>("select * from fee_rules where active and payer = 'seller' and applies_to = 'peer_resale' and scope = 'global'")).rows[0];
  const venues = (await db.query<any>("select count(*)::int n from venues v join partners p on p.id = v.partner_id where p.status = 'approved' and v.status = 'active' and v.resale_allowed")).rows[0].n;
  const rules = await resaleRules(db);
  const open = await featureOn(db, "features.peer_resale");
  const cta = user ? (seller ? "/sell/new" : "/sell/setup") : "/register?next=/sell/setup";
  return (
    <>
      <section className="grain relative isolate -mt-[4.6rem] overflow-hidden bg-navy-950 pb-20 pt-40 text-ivory sm:pt-48">
        <div aria-hidden className="absolute -left-32 top-0 -z-10 size-[44rem] animate-aurora1 rounded-full bg-[radial-gradient(circle,rgba(184,155,94,.35),transparent_62%)] blur-2xl" />
        <div className="container-page max-w-5xl">
          <p className="eyebrow-dark">For sellers</p>
          <h1 className="display mt-5">Can&apos;t make it? <em>Pass it on.</em></h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ivory/75">Got a hotel booking, dinner reservation or event ticket you can no longer use? List it in minutes, set your price, and get paid when the buyer confirms — with the money safely held in escrow in between.</p>
          <div className="mt-9 flex flex-wrap gap-3"><Button asChild variant="gold" size="lg"><Link href={cta}>{seller ? "List a booking" : "Start selling"} <ArrowRight className="arrow" /></Link></Button><Button asChild variant="glass" size="lg"><Link href="/how-it-works">How it works</Link></Button></div>
          {!open && <p role="note" className="glass mt-8 inline-block rounded-2xl px-4 py-3 text-sm text-ivory/80">Resale opens after our legal review is complete. You can set up your seller profile now.</p>}
        </div>
      </section>
      <section className="container-page mt-20 grid gap-4 md:grid-cols-3">
        {[[Tag, "You set the price", "Within the venue's resale cap — hotels and restaurants at or below what you paid, events up to a capped markup."], [Lock, "Escrow protects both sides", `Buyers pay us, not you. You deliver within ${rules.delivery_hours}h, the buyer confirms, and you're paid. No chasing anyone for money.`], [Banknote, "Simple, transparent fees", rule ? `We take ${describeRule(rule)} of the sale price, only when you actually sell. Buyers pay their own separate service fee.` : "A small fee, only when you sell."]].map(([I, t, d]: any) => (
          <div key={t} className="reveal card p-7"><I className="size-7 text-gold-700" /><h2 className="mt-4 text-2xl">{t}</h2><p className="mt-2 text-sm text-navy-900/70">{d}</p></div>
        ))}
      </section>
      <section className="container-page mt-20 grid gap-10 lg:grid-cols-2">
        <div><p className="eyebrow">What you can sell</p><h2 className="h-section mt-3">Only at <em>registered venues.</em></h2>
          <p className="mt-5 text-navy-900/75">To protect buyers, you can only list bookings and tickets at venues that are registered with Eleventh Hour — {venues} right now across hotels, restaurants and events. Each venue has its own resale terms and price cap, shown when you choose it.</p>
          <p className="mt-3 text-sm text-navy-900/60">Something bought elsewhere, or at a venue that isn&apos;t registered, can&apos;t be listed here.</p></div>
        <ol className="space-y-3">{[["Set up your seller profile", "A public name and a mobile number — once."], ["List your booking", "Pick the venue, add the details and proof of purchase, set your price."], ["Deliver when it sells", "Transfer it to the buyer and confirm the details here."], ["Get paid", "When the buyer confirms — or automatically after the event if no problem is reported."]].map(([t, d], i) => <li key={t} className="card flex gap-4 p-5"><span className="gold-gradient grid size-9 shrink-0 place-items-center rounded-full font-serif font-semibold text-navy-950">{i + 1}</span><div><p className="font-semibold">{t}</p><p className="text-sm text-navy-900/70">{d}</p></div></li>)}</ol>
      </section>
      <section className="container-page mt-16"><p className="flex items-start gap-3 rounded-2xl bg-ivory-200 p-5 text-sm text-navy-900/80"><BadgeCheck className="mt-0.5 size-5 shrink-0 text-gold-700" />Sellers must be the person who holds the booking and must be allowed to transfer it. Failed deliveries are refunded to the buyer automatically and count as strikes — {rules.max_strikes} strikes suspends selling.</p></section>
    </>
  );
}
