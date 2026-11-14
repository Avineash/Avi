import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { BadgeCheck, BellPlus, CalendarClock, Heart, Lock, MapPin, ShieldCheck, Star } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { MapView } from "@/components/map-view";
import { PriceBreakdown } from "@/components/price-breakdown";
import { deltaLabel } from "@/components/resale-card";
import { Badge, Field, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { getResaleDetail, TRANSFER_LABEL } from "@/lib/domain/resale";
import { aud, fmtDate, fmtDateTime } from "@/lib/util";
import { startResaleCheckoutAction, toggleSaveResaleAction } from "@/app/actions/resale";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const l = await getResaleDetail(id);
  return l ? { title: `${l.title} — ${l.venue_name}` } : {};
}

export default async function ResalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ listed?: string }> }) {
  const { id } = await params; const { listed } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  const l = await getResaleDetail(id, user?.id);
  if (!l || (l.partner_status !== "approved" && l.seller_id !== user?.id) || ["removed"].includes(l.status)) notFound();
  const mine = user?.id === l.seller_id;
  const delta = Math.round((1 - l.ask_unit_cents / l.original_unit_cents) * 100);
  const label = l.category === "hotel" ? "room" : l.category === "restaurant" ? "table" : "ticket";
  const key = randomUUID();
  const rules = l.rules;
  return (
    <div className="container-page py-8">
      {listed && <p role="status" className="mb-6 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success"><strong>Your listing is live.</strong> Buyers watching for matches have been notified. Manage it from <Link href="/account/selling" className="underline">My listings</Link>.</p>}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-navy-900/60"><Link href="/" className="hover:underline">Home</Link> / <Link href={`/${l.category === "hotel" ? "hotels" : l.category === "restaurant" ? "restaurants" : "events"}`} className="hover:underline">{l.category === "hotel" ? "Hotels" : l.category === "restaurant" ? "Dining" : "Events"}</Link> / <span aria-current="page">{l.title}</span></nav>
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-10">
          <div className="relative overflow-hidden rounded-[2rem] bg-navy-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.image_url ?? ""} alt={`${l.title} at ${l.venue_name}`} className="aspect-[16/8] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-950/70 to-transparent" />
            <div className="absolute left-5 top-5 flex gap-2"><Badge tone="navy">{l.category === "hotel" ? "Hotel stay" : l.category === "restaurant" ? "Dining" : "Event"}</Badge>{delta >= 5 && <Badge tone="goldSolid">{delta}% off</Badge>}</div>
          </div>
          <header>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-navy-900/70"><MapPin className="size-4" />{l.venue_name} · {l.address}, {l.suburb} <Badge tone="success"><BadgeCheck className="size-3" />Registered venue</Badge></p>
            <h1 className="h-section mt-3">{l.title}</h1>
            {l.item_detail && <p className="mt-1 text-navy-900/70">{l.item_detail}</p>}
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm"><CalendarClock className="size-4 text-gold-700" />{fmtDateTime(l.starts_at)} → {fmtDateTime(l.ends_at)}</p>
          </header>

          <section aria-labelledby="what"><h2 id="what" className="text-2xl">What you&apos;re buying</h2>
            {l.description && <p className="mt-2 whitespace-pre-line text-navy-900/80">{l.description}</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="card p-4"><dt className="text-xs uppercase tracking-wide text-navy-900/50">How it&apos;s transferred</dt><dd className="mt-1 font-medium">{TRANSFER_LABEL[l.transfer_method]}</dd>{l.transfer_notes && <dd className="mt-1 text-navy-900/70">{l.transfer_notes}</dd>}</div>
              <div className="card p-4"><dt className="text-xs uppercase tracking-wide text-navy-900/50">Venue&apos;s transfer guidance</dt><dd className="mt-1 text-navy-900/80">{l.transfer_instructions ?? "Contact the venue with the booking reference after purchase. The seller arranges the transfer."}</dd></div>
              <div className="card p-4"><dt className="text-xs uppercase tracking-wide text-navy-900/50">Price the seller paid</dt><dd className="mt-1 font-medium">{aud(l.original_unit_cents)} each</dd><dd className="text-navy-900/70">{deltaLabel(delta)}{l.max_markup_bps > 10000 ? ` · resale capped at ${(l.max_markup_bps / 100).toFixed(0)}% of face value` : " · this venue's resale is capped at face value"}</dd></div>
              <div className="card p-4"><dt className="text-xs uppercase tracking-wide text-navy-900/50">Proof of purchase</dt><dd className="mt-1 font-medium">Held by Eleventh Hour</dd><dd className="text-navy-900/70">Seller-declared booking reference and confirmation, kept on file. Your payment is protected regardless.</dd></div>
            </dl>
          </section>

          <section aria-labelledby="protect" className="card border-gold-500/40 bg-gold-300/10 p-6">
            <h2 id="protect" className="flex items-center gap-2 text-2xl"><ShieldCheck className="size-6 text-gold-700" />Buyer protection</h2>
            <ol className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
              <li><p className="font-semibold">1 · Held in escrow</p><p className="mt-1 text-navy-900/75">You pay Eleventh Hour, not the seller. The seller sees nothing until it&apos;s secured.</p></li>
              <li><p className="font-semibold">2 · Delivered in time</p><p className="mt-1 text-navy-900/75">The seller must deliver within {rules.delivery_hours} hours (and before the event). If they don&apos;t, you&apos;re refunded automatically — in full.</p></li>
              <li><p className="font-semibold">3 · You confirm</p><p className="mt-1 text-navy-900/75">The seller is only paid when you confirm — or {rules.release_after_start_hours}h after the event with no problem reported.</p></li>
            </ol>
            <p className="mt-4 text-sm text-navy-900/70">Cancel free before delivery. Problem after delivery? Report it and the money stays frozen while we review. Your rights under the Australian Consumer Law always apply. <Link href="/legal/refunds" className="underline">Full policy</Link></p>
          </section>

          <section aria-labelledby="seller"><h2 id="seller" className="text-2xl">Your seller</h2>
            <div className="card mt-3 p-5">
              <div className="flex items-center gap-4"><span className="grid size-14 place-items-center rounded-full bg-navy-900 font-serif text-2xl text-gold-300">{l.seller.display_name[0]}</span>
                <div><p className="font-serif text-xl"><Link href={`/sellers/${l.seller_id}`} className="hover:underline">{l.seller.display_name}</Link></p>
                  <p className="flex flex-wrap items-center gap-x-3 text-sm text-navy-900/70">{l.seller.reviews > 0 ? <span className="inline-flex items-center gap-1"><Star className="size-4 fill-gold-500 text-gold-500" />{l.seller.rating.toFixed(1)} · {l.seller.reviews} review{l.seller.reviews > 1 ? "s" : ""}</span> : <span>New seller · no reviews yet</span>}<span>{l.seller.sales} completed sale{l.seller.sales === 1 ? "" : "s"}</span><span>Joined {fmtDate(l.seller.created_at)}</span></p></div></div>
              {l.reviews.length > 0 && <ul className="mt-4 space-y-2 border-t border-navy-900/10 pt-4 text-sm">{l.reviews.map((r: any, i: number) => <li key={i}><span className="font-semibold">{"★".repeat(r.rating)}<span className="text-navy-900/20">{"★".repeat(5 - r.rating)}</span></span> <span className="text-navy-900/60">{r.name.split(" ")[0]} · {fmtDate(r.created_at)}</span>{r.comment && <p>{r.comment}</p>}</li>)}</ul>}
            </div>
          </section>
          <section aria-labelledby="loc"><h2 id="loc" className="text-2xl">Location</h2><MapView basePath="/resale" className="mt-3 h-64" pins={[{ venueId: l.venue_id, name: l.venue_name, suburb: l.suburb, lat: l.lat, lng: l.lng, fromCents: l.ask_unit_cents, category: l.category, listingId: l.id, count: 1, soldOut: !l.sellable }]} /></section>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start" aria-label="Buy">
          <div className="card space-y-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                {delta !== 0 && <p className="text-sm text-navy-900/55"><span className="line-through">{aud(l.original_unit_cents)}</span> {delta > 0 ? <Badge tone="gold">save {delta}%</Badge> : null}</p>}
                <p className="numeral text-4xl font-medium text-navy-900">{aud(l.ask_unit_cents)}</p>
                <p className="text-xs text-navy-900/55">per {label} · {deltaLabel(delta)}</p>
              </div>
              <form action={toggleSaveResaleAction}><input type="hidden" name="listingId" value={l.id} /><button className="grid size-10 place-items-center rounded-full border border-navy-900/15 hover:bg-navy-900/5" aria-label={l.saved ? "Remove from saved" : "Save this listing"}><Heart className={`size-5 ${l.saved ? "fill-gold-500 text-gold-500" : ""}`} /></button></form>
            </div>
            <p className="rounded-xl bg-ivory-100 px-3 py-2 text-sm font-medium">{l.sellable ? <span className={l.quantity_available <= 1 ? "text-amber-700" : "text-success"}>{l.quantity_available} of {l.quantity_total} available</span> : <span className="text-danger">{l.status === "sold_out" ? "Sold" : "No longer available"}</span>}</p>
            <PriceBreakdown rows={[{ label: label[0].toUpperCase() + label.slice(1), cents: l.ask_unit_cents }, { label: "Service fee", cents: l.buyerFeeUnitCents, hint: "Buyer protection · includes GST" }]} total={l.totalUnitCents} gstCents={Math.round(l.buyerFeeUnitCents / 11)} note="Item price is a private sale (no GST added). Exact total for multiple items is shown before you pay." />
            {mine ? <Button asChild variant="outline" className="w-full"><Link href="/account/selling">Manage your listing</Link></Button>
            : !l.sellable ? <Button asChild variant="gold" size="lg" className="w-full"><Link href={`/account/wanted?venue=${l.venue_id}`}><BellPlus /> Alert me when similar is listed</Link></Button>
            : user && user.role !== "customer" ? <p className="rounded-xl bg-navy-900/5 p-3 text-sm">Sign in with a buyer account to purchase.</p>
            : (
              <ActionForm action={startResaleCheckoutAction} submit={user ? "Buy securely" : "Sign in to buy"} variant="gold" size="lg" submitClassName="w-full" className="space-y-3">
                <input type="hidden" name="listingId" value={l.id} /><input type="hidden" name="idempotencyKey" value={key} />
                {l.quantity_available > 1 && <Field label={`${label[0].toUpperCase()}${label.slice(1)}s`} htmlFor="quantity"><Select id="quantity" name="quantity">{Array.from({ length: Math.min(l.quantity_available, 10) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>}
                {l.quantity_available <= 1 && <input type="hidden" name="quantity" value="1" />}
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required className="mt-1 size-4 accent-navy-900" /><span>I understand my payment is held in escrow, the seller must deliver within {rules.delivery_hours}h, and I accept the <Link href="/legal/terms" className="underline">Terms</Link>.</span></label>
              </ActionForm>
            )}
            <p className="flex items-center gap-1.5 text-xs text-navy-900/55"><Lock className="size-3.5" />Held {rules.hold_minutes} minutes while you pay · starts {fmtDate(l.starts_at)}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
