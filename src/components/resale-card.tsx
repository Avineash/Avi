import Link from "next/link";
import { ArrowUpRight, Clock, Heart, ShieldCheck, Star } from "lucide-react";
import { aud, fmtDateTime } from "@/lib/util";
import { TRANSFER_LABEL, type ResaleCard as R } from "@/lib/domain/resale";
import { toggleSaveResaleAction } from "@/app/actions/resale";

const KIND = { hotel: "Hotel stay", restaurant: "Dining", event: "Event" } as const;

export function deltaLabel(pct: number) {
  return pct > 0 ? `${pct}% below what was paid` : pct === 0 ? "At face value" : `${Math.abs(pct)}% over face value`;
}

/** Editorial resale card: image-led, with the seller's reputation and the all-in price up front. */
export function ResaleCard({ l, signedIn }: { l: R; signedIn?: boolean }) {
  const sold = l.status === "sold_out" || l.quantity_available === 0;
  return (
    <article className="group relative isolate overflow-hidden rounded-[1.75rem] bg-white shadow-card ring-1 ring-navy-900/[.06] transition-all duration-500 hover:-translate-y-1.5 hover:shadow-float">
      <div className="relative aspect-[4/4.2] overflow-hidden bg-navy-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={l.image_url ?? ""} alt="" loading="lazy" className="size-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.07]" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/35 to-transparent" />
        <div className="absolute left-3.5 top-3.5 flex flex-wrap gap-1.5">
          <span className="glass rounded-full px-3 py-1 text-[11px] font-medium text-ivory">{KIND[l.category]}</span>
          {!sold && l.delta_pct >= 5 && <span className="gold-gradient rounded-full px-3 py-1 text-[11px] font-semibold text-navy-950">{l.delta_pct}% off</span>}
        </div>
        {signedIn && (
          <form action={toggleSaveResaleAction} className="absolute right-3.5 top-3.5 z-10">
            <input type="hidden" name="listingId" value={l.id} />
            <button aria-label={l.saved ? "Remove from saved" : "Save"} className="glass grid size-9 place-items-center rounded-full text-ivory transition-transform hover:scale-110"><Heart className={`size-4 ${l.saved ? "fill-gold-400 text-gold-400" : ""}`} /></button>
          </form>
        )}
        {sold && <div className="absolute inset-x-0 top-1/2 grid -translate-y-1/2 place-items-center"><span className="glass rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-ivory">Sold · set an alert</span></div>}
        <div className="absolute inset-x-0 bottom-0 p-5 text-ivory">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gold-300">{l.venue_name} · {l.suburb}</p>
          <h3 className="mt-1.5 line-clamp-2 font-serif text-[1.5rem] leading-[1.08] tracking-[-0.02em] text-ivory"><Link href={`/resale/${l.id}`} className="after:absolute after:inset-0 after:z-0">{l.title}</Link></h3>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ivory/75"><span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{fmtDateTime(l.starts_at)}</span><span>{TRANSFER_LABEL[l.transfer_method]}</span></p>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="flex items-baseline gap-2"><span className="numeral text-[1.7rem] font-medium leading-none text-navy-900">{aud(l.ask_unit_cents, { whole: true })}</span>{l.delta_pct !== 0 && <span className="text-xs text-navy-900/45 line-through">{aud(l.original_unit_cents, { whole: true })}</span>}</p>
            <p className="mt-1 text-[11px] text-navy-900/55">{aud(l.total_unit_cents)} all-in · {deltaLabel(l.delta_pct)}</p>
          </div>
          <div className="text-right"><p className={`text-xs font-semibold ${sold ? "text-danger" : l.quantity_available <= 1 ? "text-amber-700" : "text-success"}`}>{sold ? "Sold" : `${l.quantity_available} available`}</p></div>
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-900 text-ivory transition-all duration-300 group-hover:bg-gold-500 group-hover:text-navy-950"><ArrowUpRight className="size-4" /></span>
        </div>
        <p className="mt-3 flex items-center gap-2 border-t border-navy-900/[.07] pt-3 text-xs text-navy-900/65">
          <span className="grid size-6 place-items-center rounded-full bg-navy-900/10 font-semibold text-navy-900">{l.seller_name[0]}</span>
          <span className="font-medium text-navy-900">{l.seller_name}</span>
          {l.seller_reviews > 0 ? <span className="inline-flex items-center gap-1"><Star className="size-3 fill-gold-500 text-gold-500" />{l.seller_rating.toFixed(1)} ({l.seller_reviews})</span> : <span>New seller</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-success"><ShieldCheck className="size-3.5" />Escrow</span>
        </p>
      </div>
    </article>
  );
}
