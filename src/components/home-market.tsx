import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeCheck, BellRing, Lock, ShieldCheck, Tag } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { ResaleCard } from "@/components/resale-card";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchResale, type ResaleCard as R } from "@/lib/domain/resale";
import { aud, fmtDateTime } from "@/lib/util";

type Cat = "hotel" | "restaurant" | "event";

function Tile({ href, l, title, blurb, count, from, className }: { href: string; l?: R; title: string; blurb: string; count: number; from: number | null; className: string }) {
  return (
    <Link href={href} className={`reveal group relative isolate flex min-h-[15rem] flex-col justify-end overflow-hidden rounded-[2rem] bg-navy-900 p-6 text-ivory shadow-card ring-1 ring-navy-900/10 sm:p-8 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {l?.image_url && <img src={l.image_url} alt="" className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950 via-navy-950/40 to-navy-950/5" />
      <p className="eyebrow-dark">{count} listed now</p>
      <h3 className="mt-2 font-serif text-3xl leading-none text-ivory sm:text-[2.6rem]">{title}</h3>
      <p className="mt-3 max-w-sm text-sm text-ivory/75">{blurb}</p>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-ivory/80">{from ? <>from <strong className="numeral text-lg text-gold-300">{aud(from, { whole: true })}</strong></> : "Set an alert"}</span>
        <span className="glass grid size-11 place-items-center rounded-full transition-all duration-300 group-hover:border-gold-400 group-hover:bg-gold-500 group-hover:text-navy-950"><ArrowUpRight className="size-5" /></span>
      </div>
    </Link>
  );
}

export async function HomeMarket() {
  const user = await getUser();
  const db = await getDb();
  const open = await searchResale({ userId: user?.id, sort: "soonest" });
  const stack = (await searchResale({ userId: user?.id, sort: "recommended", limit: 3 }));
  const by = (c: Cat) => open.filter((l) => l.category === c);
  const cheapest = (c: Cat) => [...by(c)].sort((a, b) => a.ask_unit_cents - b.ask_unit_cents)[0];
  const stats = (await db.query<any>(
    `select (select count(*)::int from venues v join partners p on p.id = v.partner_id where p.status = 'approved' and v.status = 'active' and v.resale_allowed) as venues,
            (select count(*)::int from resale_orders where status = 'completed') as completed, (select count(*)::int from seller_profiles where status = 'active') as sellers`)).rows[0];
  const ticker = open.slice(0, 12);
  const best = [...open].sort((a, b) => b.delta_pct - a.delta_pct)[0];

  return (
    <>
      <section className="grain relative isolate -mt-[4.6rem] overflow-hidden bg-navy-950 pb-16 pt-36 text-ivory sm:pb-24 sm:pt-44">
        <div aria-hidden className="absolute -left-32 top-0 -z-10 size-[44rem] animate-aurora1 rounded-full bg-[radial-gradient(circle,rgba(184,155,94,.38),transparent_62%)] blur-2xl" />
        <div aria-hidden className="absolute -right-40 top-24 -z-10 size-[48rem] animate-aurora2 rounded-full bg-[radial-gradient(circle,rgba(58,95,154,.55),transparent_62%)] blur-2xl" />
        <div className="container-page grid items-center gap-12 lg:grid-cols-[1.35fr_.65fr]">
          <div>
            <p className="glass animate-rise inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xs font-medium text-ivory"><span aria-hidden className="size-2 animate-pulse rounded-full bg-emerald-400" /><span>{open.length} listings live · {stats.venues} registered venues · Melbourne</span></p>
            <h1 className="display mt-7 animate-rise [animation-delay:.08s]">Someone can&apos;t go. <em>You can.</em></h1>
            <p className="mt-7 max-w-xl animate-rise text-lg leading-relaxed text-ivory/75 [animation-delay:.16s]">Buy hotel stays, dining reservations and event tickets that other people can no longer use — protected by escrow. Or sell yours before it goes to waste.</p>
            <div className="mt-8 flex animate-rise flex-wrap gap-3 [animation-delay:.2s]"><Button asChild variant="gold" size="lg"><Link href="/search">Browse listings <ArrowRight className="arrow" /></Link></Button><Button asChild variant="glass" size="lg"><Link href="/sell">Sell a booking</Link></Button></div>
            <div className="mt-9 max-w-3xl animate-rise [animation-delay:.28s]"><SearchBar hideCity /></div>
            <ul className="mt-7 flex flex-wrap gap-x-7 gap-y-2 text-sm text-ivory/70">
              <li className="inline-flex items-center gap-2"><Lock className="size-4 text-gold-300" />Payment held in escrow</li>
              <li className="inline-flex items-center gap-2"><BadgeCheck className="size-4 text-gold-300" />Registered venues only</li>
              <li className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-gold-300" />Auto-refund if not delivered</li>
            </ul>
          </div>
          <div className="relative hidden h-[40rem] lg:block" aria-label="Featured listings">
            {stack.map((l, i) => (
              <Link key={l.id} href={`/resale/${l.id}`} style={{ ["--r" as string]: `${[-5, 3, -2][i]}deg`, top: `${i * 13}rem`, left: `${[0, 3, 0.5][i]}rem`, animationDelay: `${i * 0.9}s` }} className="glass absolute w-[17.5rem] animate-floaty overflow-hidden rounded-3xl text-ivory shadow-float transition-transform hover:z-10 hover:scale-[1.03]">
                <div className="relative h-24 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.image_url ?? ""} alt="" className="size-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-navy-950/80 to-transparent" />
                  {l.delta_pct >= 1 && <span className="gold-gradient absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-navy-950">{l.delta_pct}% off</span>}
                </div>
                <div className="p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-gold-300">{l.venue_name}</p><p className="mt-0.5 line-clamp-1 font-serif text-lg text-ivory">{l.title}</p>
                  <p className="mt-2 flex items-center justify-between gap-3"><span className="numeral text-2xl text-ivory">{aud(l.ask_unit_cents, { whole: true })}</span><span className="text-right text-[11px] leading-snug text-ivory/65">by {l.seller_name}<br />{fmtDateTime(l.starts_at)}</span></p></div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Live listings" className="border-y border-navy-900/10 bg-ivory-50 py-4">
        <div className="marquee"><div className="marquee-track animate-marquee">
          {[...ticker, ...ticker].map((l, i) => (
            <Link key={`${l.id}-${i}`} href={`/resale/${l.id}`} tabIndex={i >= ticker.length ? -1 : 0} className="flex items-center gap-3 whitespace-nowrap px-6 text-sm text-navy-800 hover:text-navy-950">
              <span aria-hidden className="size-1.5 rounded-full bg-gold-500" /><span className="font-medium">{l.venue_name}</span><span className="text-navy-900/50">{l.title}</span><span className="numeral font-medium">{aud(l.ask_unit_cents, { whole: true })}</span>{l.delta_pct >= 5 && <span className="text-xs font-semibold text-gold-700">−{l.delta_pct}%</span>}
            </Link>))}
        </div></div>
      </section>

      <section className="container-page mt-20" aria-labelledby="bento">
        <div className="reveal mb-10 max-w-3xl"><p className="eyebrow">Buy &amp; sell, three ways</p><h2 id="bento" className="h-section mt-3">A stay, a table, or a night out — <em>from people who can&apos;t use them.</em></h2></div>
        <div className="grid gap-4 md:grid-cols-12">
          <Tile href="/hotels" l={cheapest("hotel")} title="Hotel stays" blurb="Nights booked by someone who can't make it — transferred to you." count={by("hotel").length} from={cheapest("hotel")?.ask_unit_cents ?? null} className="md:col-span-7 md:row-span-2 md:min-h-[32rem]" />
          <Tile href="/restaurants" l={cheapest("restaurant")} title="Dining" blurb="Tables and tasting menus released late." count={by("restaurant").length} from={cheapest("restaurant")?.ask_unit_cents ?? null} className="md:col-span-5" />
          <Tile href="/events" l={cheapest("event")} title="Events" blurb="Tickets at a capped, fair price." count={by("event").length} from={cheapest("event")?.ask_unit_cents ?? null} className="md:col-span-5" />
          <div className="reveal card flex flex-col justify-between p-7 md:col-span-4">
            <div><p className="eyebrow">Escrow</p><h3 className="mt-2 text-2xl leading-tight">Your money moves only when it works.</h3></div>
            <ol className="mt-6 space-y-2 text-sm">{["You pay Eleventh Hour — not the seller", "Seller delivers within 24h", "You confirm; the seller is paid"].map((x, i) => <li key={x} className="flex gap-3"><span className="gold-gradient grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-navy-950">{i + 1}</span>{x}</li>)}</ol>
          </div>
          <div className="reveal card flex flex-col justify-between bg-navy-900 p-7 text-ivory md:col-span-4">
            <div><p className="eyebrow-dark">Registered venues only</p><h3 className="mt-2 text-2xl leading-tight text-ivory">{stats.venues} venues — and nothing else.</h3></div>
            <p className="mt-6 flex gap-3 text-sm text-ivory/75"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-300" />Resale is only possible for venues registered with Eleventh Hour, each with its own price cap. Nothing from elsewhere can be listed.</p>
          </div>
          <div className="reveal card relative flex flex-col justify-between overflow-hidden p-7 md:col-span-4">
            <div><p className="eyebrow">{best ? "Best saving right now" : "Alerts"}</p><h3 className="mt-2 text-2xl leading-tight">{best && best.delta_pct > 0 ? `${best.delta_pct}% below what the seller paid.` : "Tell us what you want."}</h3></div>
            {best ? <Link href={`/resale/${best.id}`} className="mt-6 flex items-center justify-between rounded-2xl bg-ivory-100 p-4 text-sm hover:bg-ivory-200"><span><strong>{best.title}</strong><br /><span className="text-navy-900/60">{best.venue_name}</span></span><span className="numeral text-2xl">{aud(best.ask_unit_cents, { whole: true })}</span></Link> : <Link href="/account/wanted" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline"><BellRing className="size-4" />Set an alert</Link>}
          </div>
        </div>
      </section>

      <section className="container-page mt-24" aria-labelledby="new">
        <div className="reveal flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Starting soonest</p><h2 id="new" className="h-section mt-3">Available <em>tonight &amp; this week</em></h2></div><Button asChild variant="outline"><Link href="/search?sort=soonest">See everything <ArrowRight className="arrow" /></Link></Button></div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{open.slice(0, 6).map((l) => <div key={l.id} className="reveal"><ResaleCard l={l} signedIn={!!user} /></div>)}</div>
      </section>

      <section className="container-page mt-28 grid gap-10 lg:grid-cols-2" aria-labelledby="two">
        <div className="reveal card p-8 sm:p-10"><p className="eyebrow">If you&apos;re buying</p><h2 id="two" className="mt-3 text-3xl">Get in for less — <em className="text-gold-700">safely.</em></h2>
          <ul className="mt-5 space-y-3 text-navy-900/75">{["See the seller's rating and the price they paid", "Every fee shown before you pay", "Cancel free until the seller delivers", "Auto-refund if they don't deliver in time", "Report a problem and the money stays frozen"].map((x) => <li key={x} className="flex gap-3"><BadgeCheck className="mt-0.5 size-5 shrink-0 text-gold-700" />{x}</li>)}</ul>
          <Button asChild className="mt-7"><Link href="/search">Start browsing</Link></Button></div>
        <div className="reveal card p-8 sm:p-10"><p className="eyebrow">If you&apos;re selling</p><h3 className="mt-3 text-3xl">Don&apos;t let it go <em className="text-gold-700">to waste.</em></h3>
          <ul className="mt-5 space-y-3 text-navy-900/75">{["List in minutes — only at registered venues", "Set your price within the venue's cap", "Funds held in escrow until the buyer confirms", "Paid out automatically after the event if all's well", "Build a rating buyers can trust"].map((x) => <li key={x} className="flex gap-3"><Tag className="mt-0.5 size-5 shrink-0 text-gold-700" />{x}</li>)}</ul>
          <Button asChild variant="gold" className="mt-7"><Link href="/sell">Start selling</Link></Button></div>
      </section>

      <section className="grain relative isolate mx-3 mt-28 overflow-hidden rounded-[2.5rem] bg-navy-900 px-6 py-16 text-ivory sm:mx-6 sm:px-14 sm:py-24 lg:mx-8" aria-labelledby="trust">
        <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-[30rem] animate-aurora2 rounded-full bg-[radial-gradient(circle,rgba(184,155,94,.32),transparent_65%)] blur-2xl" />
        <div className="mx-auto max-w-4xl text-center"><p className="eyebrow-dark">Built on trust</p><h2 id="trust" className="h-section on-dark mt-3">Strangers selling to strangers — <em>made safe.</em></h2>
          <p className="mx-auto mt-5 max-w-2xl text-ivory/75">Escrow, automatic refunds, verified venues, price caps and seller ratings do the work that trust usually does. {stats.completed > 0 ? `${stats.completed} completed sale${stats.completed === 1 ? "" : "s"} so far from ${stats.sellers} sellers.` : ""}</p>
          <Button asChild variant="gold" size="lg" className="mt-8"><Link href="/how-it-works">How buyer protection works <ArrowRight className="arrow" /></Link></Button></div>
      </section>
    </>
  );
}
