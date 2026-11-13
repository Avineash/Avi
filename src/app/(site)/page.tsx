import Link from "next/link";
import { ArrowRight, BadgeCheck, BellRing, Hotel, PartyPopper, Receipt, UtensilsCrossed } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { ListingCard } from "@/components/listing-card";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { searchListings } from "@/lib/domain/search";
import { aud } from "@/lib/util";

const CATS = [
  { href: "/hotels", cat: "hotel" as const, title: "Last-minute hotel stays", blurb: "Tonight's unsold rooms at boutique and five-star hotels.", Icon: Hotel },
  { href: "/restaurants", cat: "restaurant" as const, title: "Restaurants & dining", blurb: "Prepaid tables and tasting menus released at the eleventh hour.", Icon: UtensilsCrossed },
  { href: "/events", cat: "event" as const, title: "Events & experiences", blurb: "Tickets, tours and nights out — this week, this weekend.", Icon: PartyPopper },
];

export default async function Home() {
  const user = await getUser();
  const all = await searchListings({ userId: user?.id, sort: "soonest" });
  const tonight = all.filter((l) => l.available_units > 0).slice(0, 6);
  const picks = user ? (await searchListings({ userId: user.id, sort: "recommended", availability: "available", limit: 3 })) : [];
  const from = (c: string) => { const m = all.filter((l) => l.category === c && l.available_units > 0); return m.length ? Math.min(...m.map((l) => l.current_price_cents)) : null; };
  const count = (c: string) => all.filter((l) => l.category === c && l.available_units > 0).length;

  return (
    <>
      <section className="relative overflow-hidden bg-navy-900 text-ivory">
        <div className="absolute inset-0 opacity-30" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 80% 20%, #b89b5e 0, transparent 40%), radial-gradient(circle at 10% 90%, #26477d 0, transparent 50%)" }} />
        <div className="container-page relative py-16 sm:py-24">
          <p className="eyebrow text-gold-300">Melbourne · tonight &amp; this week</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.08] text-ivory sm:text-6xl">The best of Melbourne, <span className="text-gold-300">at the eleventh hour.</span></h1>
          <p className="mt-5 max-w-2xl text-lg text-ivory/80">Verified rooms, tables and tickets that venues haven&apos;t sold — at honest prices with every fee shown up front. Sold out? Join the waitlist and get a fair, time-limited offer.</p>
          <div className="mt-8 max-w-5xl"><SearchBar /></div>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ivory/75">
            <li className="inline-flex items-center gap-2"><BadgeCheck className="size-4 text-gold-300" />ABN-verified partners</li>
            <li className="inline-flex items-center gap-2"><Receipt className="size-4 text-gold-300" />All-in AUD pricing, GST included</li>
            <li className="inline-flex items-center gap-2"><BellRing className="size-4 text-gold-300" />Real-time availability</li>
          </ul>
        </div>
      </section>

      <section className="container-page -mt-10 grid gap-4 md:grid-cols-3" aria-label="Categories">
        {CATS.map(({ href, cat, title, blurb, Icon }) => (
          <Link key={href} href={href} className="card group relative p-6 transition-shadow hover:shadow-lg">
            <Icon className="size-8 text-gold-600" aria-hidden />
            <h2 className="mt-4 text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-navy-900/70">{blurb}</p>
            <p className="mt-4 flex items-center justify-between text-sm"><span className="text-navy-900/60">{count(cat)} available now{from(cat) ? ` · from ${aud(from(cat), { whole: true })}` : ""}</span><ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></p>
          </Link>
        ))}
      </section>

      {picks.length > 0 && (
        <section className="container-page mt-16" aria-labelledby="rec">
          <p className="eyebrow">Personalised</p><h2 id="rec" className="mt-1 text-3xl font-semibold">Picked for you</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{picks.map((l) => <ListingCard key={l.id} l={l} signedIn />)}</div>
        </section>
      )}

      <section className="container-page mt-16" aria-labelledby="soon">
        <div className="flex items-end justify-between gap-4">
          <div><p className="eyebrow">Starting soonest</p><h2 id="soon" className="mt-1 text-3xl font-semibold">Available tonight &amp; tomorrow</h2></div>
          <Button asChild variant="outline" size="sm"><Link href="/search?sort=soonest">See everything</Link></Button>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{tonight.map((l) => <ListingCard key={l.id} l={l} signedIn={!!user} />)}</div>
      </section>

      <section className="container-page mt-20 grid items-center gap-10 rounded-[2rem] bg-navy-900 p-8 text-ivory sm:p-14 lg:grid-cols-2" aria-labelledby="wl">
        <div>
          <p className="eyebrow text-gold-300">The waitlist, done fairly</p>
          <h2 id="wl" className="mt-2 text-3xl font-semibold text-ivory sm:text-4xl">Sold out isn&apos;t the end.</h2>
          <p className="mt-4 text-ivory/80">Join the waitlist for any sold-out room, table or event and set the most you&apos;d pay. If a place opens up — a cancellation, or the venue releasing more — you get a time-limited offer. You only ever pay the price shown to you, never your maximum.</p>
          <p className="mt-3 text-sm text-ivory/60">Venues publish how waitlist priority works. A confirmed booking is never cancelled just because someone else offers more — a venue can only <em>ask</em> a guest if they&apos;d like to release it, with a full refund plus compensation, and the guest is free to say no.</p>
          <Button asChild variant="gold" className="mt-6"><Link href="/how-it-works">How it works</Link></Button>
        </div>
        <ol className="space-y-4">
          {[["Join", "Pick a sold-out listing and set your maximum price."], ["Get notified", "We message you the moment a place is released."], ["Accept in time", "Confirm within the countdown and pay securely."]].map(([t, d], i) => (
            <li key={t} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-500 font-serif font-semibold text-navy-950">{i + 1}</span><div><p className="font-semibold text-ivory">{t}</p><p className="text-sm text-ivory/70">{d}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="container-page mt-20 text-center">
        <p className="eyebrow">For hotels, restaurants &amp; event organisers</p>
        <h2 className="mx-auto mt-2 max-w-2xl text-3xl font-semibold">Turn unsold inventory into revenue — without devaluing your brand.</h2>
        <div className="mt-6 flex justify-center gap-3"><Button asChild size="lg"><Link href="/partners">Become a partner</Link></Button><Button asChild size="lg" variant="outline"><Link href="/how-it-works">See how it works</Link></Button></div>
      </section>
    </>
  );
}
