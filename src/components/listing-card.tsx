import Link from "next/link";
import { ArrowUpRight, Clock, Heart, Star } from "lucide-react";
import { aud, fmtDateTime } from "@/lib/util";
import { POLICY_LABEL, type CancellationPolicy } from "@/lib/domain/policies";
import type { ListingCard as L } from "@/lib/domain/search";
import { toggleSaveAction } from "@/app/actions/account";

const KIND = { hotel: "Hotel stay", restaurant: "Dining", event: "Event" } as const;

/** Editorial card: image-led with the title set over a gradient, practical numbers underneath. */
export function ListingCard({ l, signedIn, className = "" }: { l: L; signedIn?: boolean; className?: string }) {
  const sold = l.available_units === 0;
  return (
    <article className={`group relative isolate overflow-hidden rounded-[1.75rem] bg-white shadow-card ring-1 ring-navy-900/[.06] transition-all duration-500 hover:-translate-y-1.5 hover:shadow-float ${className}`}>
      <div className="relative aspect-[4/4.2] overflow-hidden bg-navy-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={l.image_url ?? ""} alt="" loading="lazy" className="size-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.07]" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/35 to-transparent" />
        <div className="absolute left-3.5 top-3.5 flex flex-wrap gap-1.5">
          <span className="glass rounded-full px-3 py-1 text-[11px] font-medium text-ivory">{KIND[l.category]}</span>
          {l.promo_label && <span className="gold-gradient rounded-full px-3 py-1 text-[11px] font-semibold text-navy-950">{l.promo_label}</span>}
          {!sold && l.discount_pct >= 5 && <span className="gold-gradient rounded-full px-3 py-1 text-[11px] font-semibold text-navy-950">{l.discount_pct}% off</span>}
        </div>
        {signedIn && (
          <form action={toggleSaveAction} className="absolute right-3.5 top-3.5 z-10">
            <input type="hidden" name="listingId" value={l.id} />
            <button aria-label={l.saved ? "Remove from saved" : "Save"} className="glass grid size-9 place-items-center rounded-full text-ivory transition-transform hover:scale-110"><Heart className={`size-4 ${l.saved ? "fill-gold-400 text-gold-400" : ""}`} /></button>
          </form>
        )}
        {sold && <div className="absolute inset-x-0 top-1/2 grid -translate-y-1/2 place-items-center"><span className="glass rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-ivory">Sold out · waitlist open</span></div>}
        <div className="absolute inset-x-0 bottom-0 p-5 text-ivory">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gold-300">{l.venue_name} · {l.suburb}</p>
          <h3 className="mt-1.5 line-clamp-2 font-serif text-[1.55rem] leading-[1.08] tracking-[-0.02em] text-ivory"><Link href={`/listings/${l.id}`} className="after:absolute after:inset-0 after:z-0 focus-visible:after:ring-2 focus-visible:after:ring-gold-400">{l.title}</Link></h3>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ivory/75">
            <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{fmtDateTime(l.starts_at)}</span>
            {l.review_count > 0 ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-gold-400 text-gold-400" />{l.rating.toFixed(1)} <span className="text-ivory/50">({l.review_count})</span></span> : <span className="text-ivory/50">New</span>}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 px-5 py-4">
        <div>
          <p className="flex items-baseline gap-2"><span className="numeral text-[1.7rem] font-medium leading-none text-navy-900">{aud(l.current_price_cents, { whole: true })}</span><span className="text-xs text-navy-900/45 line-through">{aud(l.original_price_cents, { whole: true })}</span></p>
          <p className="mt-1 text-[11px] text-navy-900/55">{aud(l.total_price_cents)} total · fees &amp; GST incl.</p>
        </div>
        <div className="text-right">
          <p className={`text-xs font-semibold ${sold ? "text-danger" : l.available_units <= 2 ? "text-amber-700" : "text-success"}`}>{sold ? "Sold out" : `${l.available_units} left`}</p>
          <p className="mt-1 text-[11px] text-navy-900/55">{POLICY_LABEL[l.cancellation_policy as CancellationPolicy]}</p>
        </div>
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-900 text-ivory transition-all duration-300 group-hover:bg-gold-500 group-hover:text-navy-950"><ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
      </div>
    </article>
  );
}
