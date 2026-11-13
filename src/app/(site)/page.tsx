import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeCheck, Receipt, ShieldCheck, Timer } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { ListingCard } from "@/components/listing-card";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchListings, type ListingCard as L } from "@/lib/domain/search";
import { aud, fmtDateTime } from "@/lib/util";

type Cat = "hotel" | "restaurant" | "event";

function Tile({ href, l, title, blurb, count, from, className }: { href: string; l?: L; title: string; blurb: string; count: number; from: number | null; className: string }) {
  return (
    <Link href={href} className={`reveal group relative isolate flex min-h-[15rem] flex-col justify-end overflow-hidden rounded-[2rem] bg-navy-900 p-6 text-ivory shadow-card ring-1 ring-navy-900/10 sm:p-8 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {l?.image_url && <img src={l.image_url} alt="" className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950 via-navy-950/40 to-navy-950/5" />
      <p className="eyebrow-dark">{count} available now</p>
      <h3 className="mt-2 font-serif text-3xl leading-none text-ivory sm:text-[2.6rem]">{title}</h3>
      <p className="mt-3 max-w-sm text-sm text-ivory/75">{blurb}</p>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-ivory/80">{from ? <>from <strong className="numeral text-lg text-gold-300">{aud(from, { whole: true })}</strong></> : "Join the waitlist"}</span>
        <span className="glass grid size-11 place-items-center rounded-full transition-all duration-300 group-hover:border-gold-400 group-hover:bg-gold-500 group-hover:text-navy-950"><ArrowUpRight className="size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
      </div>
    </Link>
  );
}

export default async function Home() {
  const user = await getUser();
  const db = await getDb();
  const all = await searchListings({ userId: user?.id, sort: "soonest" });
  const open = all.filter((l) => l.available_units > 0);
  const stack = (await searchListings({ userId: user?.id, sort: "recommended", availability: "available", limit: 3 }));
  const tonight = open.slice(0, 6);
  const picks = user ? await searchListings({ userId: user.id, sort: "recommended", availability: "available", limit: 3 }) : [];
  const by = (c: Cat) => open.filter((l) => l.category === c);
  const cheapest = (c: Cat) => by(c).sort((a, b) => a.current_price_cents - b.current_price_cents)[0];
  const stats = (await db.query<any>(
    `select (select count(*)::int from partners where status = 'approved') as partners, (select count(*)::int from waitlist_entries where status in ('active','offered')) as waiting`)).rows[0];
  const ticker = open.slice(0, 12);
  const demo = open.find((l) => l.category === "hotel") ?? open[0];

  return (
    <>
      {/* ───────── Hero ───────── */}
      <section className="grain relative isolate -mt-[4.6rem] overflow-hidden bg-navy-950 pb-16 pt-36 text-ivory sm:pb-24 sm:pt-44">
        <div aria-hidden className="absolute -left-32 top-0 -z-10 size-[44rem] animate-aurora1 rounded-full bg-[radial-gradient(circle,rgba(184,155,94,.38),transparent_62%)] blur-2xl" />
        <div aria-hidden className="absolute -right-40 top-24 -z-10 size-[48rem] animate-aurora2 rounded-full bg-[radial-gradient(circle,rgba(58,95,154,.55),transparent_62%)] blur-2xl" />
        <div className="container-page grid items-center gap-12 lg:grid-cols-[1.35fr_.65fr]">
          <div>
            <p className="glass animate-rise inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xs font-medium text-ivory">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-emerald-400" />
              <span>Live in Melbourne · {by("hotel").length} rooms · {by("restaurant").length} tables · {by("event").length} events open</span>
            </p>
            <h1 className="display mt-7 animate-rise [animation-delay:.08s]">Melbourne tonight, at the <em>eleventh hour.</em></h1>
            <p className="mt-7 max-w-xl animate-rise text-lg leading-relaxed text-ivory/75 [animation-delay:.16s]">Rooms, tables and tickets that venues haven&apos;t sold — at honest all-in prices. Sold out? Join the waitlist and get a fair, time-limited offer.</p>
            <div className="mt-9 max-w-3xl animate-rise [animation-delay:.24s]"><SearchBar hideCity /></div>
            <ul className="mt-7 flex flex-wrap gap-x-7 gap-y-2 text-sm text-ivory/70">
              <li className="inline-flex items-center gap-2"><BadgeCheck className="size-4 text-gold-300" />ABN-verified partners only</li>
              <li className="inline-flex items-center gap-2"><Receipt className="size-4 text-gold-300" />Every fee shown, GST included</li>
              <li className="inline-flex items-center gap-2"><Timer className="size-4 text-gold-300" />Real-time availability</li>
            </ul>
          </div>
          <div className="relative hidden h-[40rem] lg:block" aria-label="Featured availability">
            {stack.map((l, i) => (
              <Link key={l.id} href={`/listings/${l.id}`} style={{ ["--r" as string]: `${[-5, 3, -2][i]}deg`, top: `${i * 13}rem`, left: `${[0, 3, 0.5][i]}rem`, animationDelay: `${i * 0.9}s` }}
                className="glass absolute w-[17.5rem] animate-floaty overflow-hidden rounded-3xl text-ivory shadow-float transition-transform hover:z-10 hover:scale-[1.03]">
                <div className="relative h-24 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.image_url ?? ""} alt="" className="size-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-navy-950/80 to-transparent" />
                  <span className="gold-gradient absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-navy-950">{l.discount_pct}% off</span>
                </div>
                <div className="p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-gold-300">{l.venue_name}</p>
                  <p className="mt-0.5 line-clamp-1 font-serif text-lg text-ivory">{l.title}</p>
                  <p className="mt-2 flex items-end justify-between"><span className="numeral text-2xl text-ivory">{aud(l.current_price_cents, { whole: true })}</span><span className="text-xs text-ivory/65">{l.available_units} left · {fmtDateTime(l.starts_at)}</span></p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── Live ticker ───────── */}
      <section aria-label="Live availability" className="border-y border-navy-900/10 bg-ivory-50 py-4">
        <div className="marquee">
          <div className="marquee-track animate-marquee" aria-hidden={false}>
            {[...ticker, ...ticker].map((l, i) => (
              <Link key={`${l.id}-${i}`} href={`/listings/${l.id}`} tabIndex={i >= ticker.length ? -1 : 0} className="flex items-center gap-3 whitespace-nowrap px-6 text-sm text-navy-800 hover:text-navy-950">
                <span aria-hidden className="size-1.5 rounded-full bg-gold-500" />
                <span className="font-medium">{l.venue_name}</span><span className="text-navy-900/50">{l.title}</span>
                <span className="numeral font-medium">{aud(l.current_price_cents, { whole: true })}</span>
                {l.discount_pct >= 5 && <span className="text-xs font-semibold text-gold-700">−{l.discount_pct}%</span>}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── Bento ───────── */}
      <section className="container-page mt-20" aria-labelledby="bento">
        <div className="reveal mb-10 max-w-3xl">
          <p className="eyebrow">Three ways to say yes tonight</p>
          <h2 id="bento" className="h-section mt-3">Stay, dine, or go out — <em>all in one place.</em></h2>
        </div>
        <div className="grid gap-4 md:grid-cols-12">
          <Tile href="/hotels" l={cheapest("hotel")} title="Hotel stays" blurb="Tonight's unsold rooms at boutique and five-star hotels." count={by("hotel").length} from={cheapest("hotel")?.current_price_cents ?? null} className="md:col-span-7 md:row-span-2 md:min-h-[32rem]" />
          <Tile href="/restaurants" l={cheapest("restaurant")} title="Dining" blurb="Prepaid tables and tasting menus released late." count={by("restaurant").length} from={cheapest("restaurant")?.current_price_cents ?? null} className="md:col-span-5" />
          <Tile href="/events" l={cheapest("event")} title="Events" blurb="Tickets, tours and nights out this week." count={by("event").length} from={cheapest("event")?.current_price_cents ?? null} className="md:col-span-5" />

          <div className="reveal card flex flex-col justify-between p-7 md:col-span-4">
            <div><p className="eyebrow">No drip pricing</p><h3 className="mt-2 text-2xl leading-tight">The price you see is the price you pay.</h3></div>
            {demo && (
              <dl className="mt-6 space-y-2 rounded-2xl bg-ivory-100 p-4 text-sm">
                <div className="flex justify-between"><dt className="text-navy-900/65">{demo.category === "hotel" ? "Room" : "Price"}</dt><dd className="numeral">{aud(demo.current_price_cents)}</dd></div>
                <div className="flex justify-between"><dt className="text-navy-900/65">Service fee</dt><dd className="numeral">{aud(demo.total_price_cents - demo.current_price_cents)}</dd></div>
                <div className="flex justify-between border-t border-navy-900/15 pt-2 font-semibold"><dt>Total, GST incl.</dt><dd className="numeral text-lg">{aud(demo.total_price_cents)}</dd></div>
              </dl>
            )}
          </div>
          <div className="reveal card relative flex flex-col justify-between overflow-hidden p-7 md:col-span-4">
            <div><p className="eyebrow">Fair waitlist</p><h3 className="mt-2 text-2xl leading-tight">Sold out? Get offered a place, not ignored.</h3></div>
            <div className="mt-6 flex items-end gap-4"><span className="numeral text-6xl leading-none text-navy-900">{stats.waiting}</span><span className="pb-1 text-sm text-navy-900/65">people on waitlists right now — each only ever pays the offer price.</span></div>
          </div>
          <div className="reveal card flex flex-col justify-between bg-navy-900 p-7 text-ivory md:col-span-4">
            <div><p className="eyebrow-dark">Registered partners only</p><h3 className="mt-2 text-2xl leading-tight text-ivory">{stats.partners} verified venues — and nothing else.</h3></div>
            <p className="mt-6 flex gap-3 text-sm text-ivory/75"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-300" />Resale and reallocation are only possible for inventory from partners registered and approved here. Nothing is ever resold from outside the platform.</p>
          </div>
        </div>
      </section>

      {/* ───────── Tonight ───────── */}
      <section className="container-page mt-24" aria-labelledby="soon">
        <div className="reveal flex flex-wrap items-end justify-between gap-4">
          <div><p className="eyebrow">Starting soonest</p><h2 id="soon" className="h-section mt-3">Available <em>tonight &amp; tomorrow</em></h2></div>
          <Button asChild variant="outline"><Link href="/search?sort=soonest">See everything <ArrowRight className="arrow" /></Link></Button>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{tonight.map((l) => <div key={l.id} className="reveal"><ListingCard l={l} signedIn={!!user} /></div>)}</div>
      </section>

      {picks.length > 0 && (
        <section className="container-page mt-24" aria-labelledby="rec">
          <div className="reveal"><p className="eyebrow">Personalised</p><h2 id="rec" className="h-section mt-3">Picked <em>for you</em></h2></div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{picks.map((l) => <div key={l.id} className="reveal"><ListingCard l={l} signedIn /></div>)}</div>
        </section>
      )}

      {/* ───────── How it works (sticky story) ───────── */}
      <section className="container-page mt-28 grid gap-10 lg:grid-cols-[.8fr_1.2fr]" aria-labelledby="how">
        <div className="lg:sticky lg:top-32 lg:h-fit">
          <p className="eyebrow">How it works</p>
          <h2 id="how" className="h-section mt-3">Three taps from <em>spontaneous</em> to sorted.</h2>
          <p className="mt-5 max-w-md text-navy-900/70">Your place is held while you pay. Funds are only captured once it&apos;s confirmed — so you&apos;re never charged for something you didn&apos;t get.</p>
          <Button asChild className="mt-7"><Link href="/how-it-works">The full story <ArrowRight className="arrow" /></Link></Button>
        </div>
        <ol className="space-y-5">
          {[["Discover", "Search by suburb, date, price and rating — in a list or on the map. Availability updates live as other guests book."], ["Book securely", "See the total including every mandatory fee, then pay by card, Apple Pay or Google Pay. Free-cancellation options are labelled on every listing."], ["Or join the waitlist", "Set the most you'd pay. If a place frees up you get a countdown offer — accept in time and it's yours."]].map(([t, d], i) => (
            <li key={t} className="reveal card relative overflow-hidden p-8 sm:p-10">
              <span aria-hidden className="numeral text-outline absolute -right-2 -top-6 text-[9rem] leading-none text-gold-500/30 sm:text-[11rem]">{i + 1}</span>
              <h3 className="relative text-3xl">{t}</h3><p className="relative mt-3 max-w-md text-navy-900/70">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ───────── Waitlist / consent (dark) ───────── */}
      <section className="grain relative isolate mx-3 mt-28 overflow-hidden rounded-[2.5rem] bg-navy-900 px-6 py-16 text-ivory sm:mx-6 sm:px-14 sm:py-24 lg:mx-8" aria-labelledby="wl">
        <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-[30rem] animate-aurora2 rounded-full bg-[radial-gradient(circle,rgba(184,155,94,.32),transparent_65%)] blur-2xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow-dark">Built on consent</p>
            <h2 id="wl" className="h-section on-dark mt-3">A booking is <em>never</em> taken from you.</h2>
            <p className="mt-6 max-w-lg text-ivory/75">When demand surges a venue can only <em>ask</em> a guest — and only one who opted in at checkout — whether they&apos;d release a booking for a full refund plus compensation shown up front. Say no, or ignore it, and nothing changes.</p>
            <ul className="mt-7 space-y-3 text-sm text-ivory/80">
              {["Opt-in at checkout, with the exact wording stored", "Refund and compensation first — room released after", "Only for partners registered and approved on Eleventh Hour"].map((x) => <li key={x} className="flex gap-3"><BadgeCheck className="mt-0.5 size-5 shrink-0 text-gold-300" />{x}</li>)}
            </ul>
            <Button asChild variant="gold" size="lg" className="mt-9"><Link href="/how-it-works">How offers work <ArrowRight className="arrow" /></Link></Button>
          </div>
          <div className="relative mx-auto grid aspect-square w-full max-w-sm place-items-center" aria-hidden>
            <svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90"><circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="6" /><circle cx="100" cy="100" r="88" fill="none" stroke="url(#gld)" strokeWidth="6" strokeLinecap="round" strokeDasharray="553" strokeDashoffset="553" style={{ animation: "ring 6s cubic-bezier(.3,.6,.2,1) infinite alternate" }} /><defs><linearGradient id="gld" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e0cb97" /><stop offset="1" stopColor="#9a7f45" /></linearGradient></defs></svg>
            <div className="text-center"><p className="numeral text-6xl text-ivory">30:00</p><p className="mt-1 text-xs uppercase tracking-[0.2em] text-gold-300">minutes to accept</p></div>
          </div>
        </div>
      </section>

      {/* ───────── Partner CTA ───────── */}
      <section className="container-page mt-28 text-center">
        <div className="reveal gold-gradient relative overflow-hidden rounded-[2.5rem] px-6 py-16 text-navy-950 sm:py-24">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-navy-950/70">For hotels, restaurants &amp; event organisers</p>
          <h2 className="mx-auto mt-4 max-w-3xl text-[clamp(2rem,1.2rem+3.6vw,4.2rem)] leading-[1.02] tracking-[-0.03em] text-navy-950">Turn unsold inventory into revenue — <em className="italic">without devaluing your brand.</em></h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3"><Button asChild size="lg"><Link href="/partners/register">Become a partner <ArrowRight className="arrow" /></Link></Button><Button asChild size="lg" variant="outline" className="border-navy-950/30 text-navy-950"><Link href="/partners">See the commercials</Link></Button></div>
        </div>
      </section>
    </>
  );
}
