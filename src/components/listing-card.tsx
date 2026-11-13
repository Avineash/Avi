import Link from "next/link";
import { Clock, MapPin, ShieldCheck, Star } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { aud, fmtDateTime } from "@/lib/util";
import { POLICY_LABEL, type CancellationPolicy } from "@/lib/domain/policies";
import type { ListingCard as L } from "@/lib/domain/search";
import { toggleSaveAction } from "@/app/actions/account";
import { Heart } from "lucide-react";

const KIND = { hotel: "Hotel stay", restaurant: "Dining", event: "Event" } as const;

export function ListingCard({ l, signedIn }: { l: L; signedIn?: boolean }) {
  const sold = l.available_units === 0;
  return (
    <article className="group card overflow-hidden transition-shadow hover:shadow-lg">
      <div className="relative aspect-[16/10] overflow-hidden bg-navy-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={l.image_url ?? ""} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <Badge tone="navy">{KIND[l.category]}</Badge>
          {l.promo_label && <Badge tone="goldSolid">{l.promo_label}</Badge>}
          {!sold && l.discount_pct >= 5 && <Badge tone="goldSolid">{l.discount_pct}% off</Badge>}
        </div>
        {signedIn && (
          <form action={toggleSaveAction} className="absolute right-3 top-3">
            <input type="hidden" name="listingId" value={l.id} />
            <button aria-label={l.saved ? "Remove from saved" : "Save"} className="grid size-9 place-items-center rounded-full bg-white/90 text-navy-900 hover:bg-white"><Heart className={`size-4 ${l.saved ? "fill-gold-500 text-gold-500" : ""}`} /></button>
          </form>
        )}
        {sold && <div className="absolute inset-0 grid place-items-center bg-navy-950/60"><span className="rounded-full bg-ivory px-4 py-1.5 text-sm font-semibold text-navy-900">Sold out · waitlist open</span></div>}
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-navy-900/60"><MapPin className="size-3.5" />{l.venue_name} · {l.suburb}</p>
          <h3 className="mt-0.5 line-clamp-2 font-serif text-lg font-semibold leading-snug"><Link href={`/listings/${l.id}`} className="after:absolute after:inset-0 hover:underline">{l.title}</Link></h3>
          {l.subcategory && <p className="mt-0.5 line-clamp-1 text-xs text-navy-900/60">{l.subcategory}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-900/70">
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{fmtDateTime(l.starts_at)}</span>
          {l.review_count > 0 ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-gold-500 text-gold-500" />{l.rating.toFixed(1)} <span className="text-navy-900/50">({l.review_count} verified)</span></span> : <span className="text-navy-900/50">New on Eleventh Hour</span>}
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-navy-900/10 pt-3">
          <div>
            <p className="text-xs text-navy-900/60"><span className="line-through">{aud(l.original_price_cents, { whole: true })}</span></p>
            <p className="font-serif text-2xl font-semibold text-navy-900">{aud(l.current_price_cents, { whole: true })}</p>
            <p className="text-[11px] text-navy-900/60">{aud(l.total_price_cents)} total incl. fees &amp; GST</p>
          </div>
          <div className="text-right text-xs">
            <p className={sold ? "font-semibold text-danger" : l.available_units <= 2 ? "font-semibold text-amber-700" : "font-semibold text-success"}>{sold ? "Sold out" : `${l.available_units} left`}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-navy-900/60"><ShieldCheck className="size-3.5" />{POLICY_LABEL[l.cancellation_policy as CancellationPolicy]}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
