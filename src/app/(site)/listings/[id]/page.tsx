import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { CalendarClock, Heart, MapPin, ShieldCheck, Star, Users } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Countdown } from "@/components/countdown";
import { LiveAvailability } from "@/components/live-availability";
import { MapView } from "@/components/map-view";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { getListingDetail } from "@/lib/domain/search";
import { featureOn, getSetting } from "@/lib/domain/settings";
import { getDb } from "@/lib/db";
import { buybackOptInText } from "@/lib/domain/legal";
import { POLICY_LABEL, policyText, type CancellationPolicy } from "@/lib/domain/policies";
import { WAITLIST_POLICY_TEXT, waitlistPosition } from "@/lib/domain/waitlist";
import { aud, fmtDate, fmtDateTime } from "@/lib/util";
import { startCheckoutAction } from "@/app/actions/booking";
import { toggleSaveAction } from "@/app/actions/account";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const l = await getListingDetail(id);
  return l ? { title: `${l.title} — ${l.venue_name}`, description: l.description?.slice(0, 160) } : {};
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  const l = await getListingDetail(id, user?.id);
  if (!l || l.partner_status !== "approved") notFound();
  const db = await getDb();
  const sold = l.available_units === 0;
  const closed = l.status !== "published" || new Date(l.booking_deadline) <= new Date();
  const buybackOffered = l.buyback_eligible && l.buyback_enabled && (await featureOn(db, "features.buyback"));
  const terms = (await getSetting<{ version: string }>(db, "legal.terms_version", { version: "draft" })).version;
  const pos = l.waitlistEntry ? await waitlistPosition(db, l.waitlistEntry.id) : null;
  const avg = l.reviews.length ? l.reviews.reduce((a: number, r: any) => a + r.rating, 0) / l.reviews.length : 0;
  const key = randomUUID();
  const discount = Math.max(0, Math.round((1 - l.current_price_cents / l.original_price_cents) * 100));
  const policy = l.cancellation_policy as CancellationPolicy;
  const label = l.category === "hotel" ? "room" : l.category === "restaurant" ? "table" : "ticket";

  return (
    <div className="container-page py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-navy-900/60"><Link href="/" className="hover:underline">Home</Link> / <Link href={`/${l.category === "hotel" ? "hotels" : l.category === "restaurant" ? "restaurants" : "events"}`} className="hover:underline capitalize">{l.category === "hotel" ? "Hotels" : l.category === "restaurant" ? "Dining" : "Events"}</Link> / <span aria-current="page">{l.title}</span></nav>
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          <div className="relative overflow-hidden rounded-3xl bg-navy-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.image_url ?? l.venue_image ?? ""} alt={`${l.title} at ${l.venue_name}`} className="aspect-[16/8] w-full object-cover" />
            <div className="absolute left-4 top-4 flex gap-2"><Badge tone="navy">{l.category === "hotel" ? "Hotel stay" : l.category === "restaurant" ? "Dining" : "Event"}</Badge>{discount >= 5 && <Badge tone="goldSolid">{discount}% off</Badge>}</div>
          </div>

          <header>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-navy-900/70"><MapPin className="size-4" />{l.venue_name} · {l.address}, {l.suburb}{l.star_rating ? <span className="ml-1">· {"★".repeat(l.star_rating)}</span> : null}</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{l.title}</h1>
            {l.subcategory && <p className="mt-1 text-navy-900/70">{l.subcategory}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-gold-600" />{fmtDateTime(l.starts_at)} → {fmtDateTime(l.ends_at)}</span>
              {l.reviews.length > 0 ? <span className="inline-flex items-center gap-1"><Star className="size-4 fill-gold-500 text-gold-500" />{avg.toFixed(1)} · {l.reviews.length} verified review{l.reviews.length > 1 ? "s" : ""}</span> : <span className="text-navy-900/60">No reviews yet</span>}
              <span className="inline-flex items-center gap-1 text-navy-900/70">Listed by <strong className="font-medium">{l.business_name}</strong> <Badge tone="success">ABN verified</Badge></span>
            </div>
          </header>

          <section aria-labelledby="about"><h2 id="about" className="text-xl font-semibold">About this {label}</h2><p className="mt-2 whitespace-pre-line text-navy-900/80">{l.description ?? l.venue_description}</p>
            {l.amenities?.length > 0 && <ul className="mt-4 flex flex-wrap gap-2">{l.amenities.map((a: string) => <li key={a}><Badge>{a}</Badge></li>)}</ul>}
            {Object.keys(l.meta ?? {}).length > 0 && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{Object.entries(l.meta as Record<string, unknown>).filter(([k]) => k !== "faceValueCents").map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-wide text-navy-900/50">{k.replace(/([A-Z])/g, " $1")}</dt><dd className="font-medium">{String(v)}</dd></div>)}</dl>}
          </section>

          <section aria-labelledby="terms" className="card p-5">
            <h2 id="terms" className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="size-5 text-gold-600" />Cancellation &amp; refund terms</h2>
            <p className="mt-2 font-medium">{POLICY_LABEL[policy]}</p>
            <p className="text-sm text-navy-900/80">{policyText(policy)}</p>
            <p className="mt-2 text-xs text-navy-900/60">These are the venue&apos;s change-of-mind terms. Your rights under the Australian Consumer Law (for example if the service isn&apos;t delivered as described) always apply and can&apos;t be limited. See our <Link href="/legal/refunds" className="underline">refund policy</Link>.</p>
            {l.category === "event" && <p className="mt-2 text-xs text-navy-900/60">Event tickets are non-transferable except through Eleventh Hour&apos;s regulated release process, which never exceeds the legal resale cap.</p>}
            {l.category === "restaurant" && <p className="mt-2 text-xs text-navy-900/60">Dining packages are prepaid in full — there is no separate deposit. Dietary requirements can be added in special requests.</p>}
          </section>

          {sold && !closed && (
            <section aria-labelledby="wl" className="card border-gold-500/40 bg-gold-300/10 p-5">
              <h2 id="wl" className="flex items-center gap-2 text-xl font-semibold"><Users className="size-5 text-gold-600" />How the waitlist works for this {label}</h2>
              <p className="mt-2 text-sm">{WAITLIST_POLICY_TEXT[l.waitlist_policy]}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-navy-900/80">
                <li>Offers last {l.offer_window_minutes} minutes. If you don&apos;t accept in time, it passes to the next person.</li>
                <li>You choose a maximum price (optional). You never pay more than the offer price you&apos;re shown.</li>
                <li>Joining is free and you can leave any time.</li>
              </ul>
            </section>
          )}

          <section aria-labelledby="loc"><h2 id="loc" className="text-xl font-semibold">Location</h2>
            <MapView className="mt-3 h-64" pins={[{ venueId: l.venue_id, name: l.venue_name, suburb: l.suburb, lat: l.lat, lng: l.lng, fromCents: l.current_price_cents, category: l.category, listingId: l.id, count: 1, soldOut: sold }]} />
          </section>

          <section aria-labelledby="rev"><h2 id="rev" className="text-xl font-semibold">Verified guest reviews</h2>
            {l.reviews.length === 0 ? <p className="mt-2 text-sm text-navy-900/60">Reviews appear here after guests complete a stay or event. Only people who actually booked can review.</p> : (
              <ul className="mt-3 space-y-3">{l.reviews.map((r: any, i: number) => (
                <li key={i} className="card p-4"><p className="flex items-center gap-1 text-sm font-semibold">{"★".repeat(r.rating)}<span className="text-navy-900/20">{"★".repeat(5 - r.rating)}</span><span className="ml-2 font-normal text-navy-900/60">{r.name.split(" ")[0]} · {fmtDate(r.created_at)}</span></p>{r.comment && <p className="mt-1 text-sm">{r.comment}</p>}</li>))}</ul>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Booking">
          <div className="card space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                {discount >= 1 && <p className="text-sm text-navy-900/60"><span className="line-through">{aud(l.original_price_cents)}</span> <Badge tone="gold">save {discount}%</Badge></p>}
                <p className="font-serif text-4xl font-semibold text-navy-900">{aud(l.current_price_cents)}</p>
                <p className="text-xs text-navy-900/60">per {label}, GST included</p>
              </div>
              <form action={toggleSaveAction}><input type="hidden" name="listingId" value={l.id} /><button className="grid size-10 place-items-center rounded-full border border-navy-900/15 hover:bg-navy-900/5" aria-label={l.saved ? "Remove from saved" : "Save this experience"}><Heart className={`size-5 ${l.saved ? "fill-gold-500 text-gold-500" : ""}`} /></button></form>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-ivory-100 px-3 py-2">
              <LiveAvailability listingId={l.id} initial={{ available: l.available_units, total: l.total_units }} />
              {!closed && <span className="text-xs text-navy-900/60">Book within <Countdown to={new Date(l.booking_deadline).toISOString()} className="font-semibold text-navy-900" /></span>}
            </div>
            <PriceBreakdown rows={[{ label: `${label[0].toUpperCase()}${label.slice(1)}`, cents: l.current_price_cents }, { label: "Service fee", cents: l.customerFeeCents, hint: "Mandatory, includes GST" }]} total={l.totalCents} gstCents={Math.round(l.totalCents / 11)} note="Exact total for multiple items is confirmed before you pay." />

            {closed ? <p className="rounded-xl bg-navy-900/5 p-3 text-sm">This listing is closed for booking.</p>
            : sold ? (
              l.waitlistEntry ? (
                <div className="rounded-xl bg-success/10 p-3 text-sm"><p className="font-semibold text-success">You&apos;re on the waitlist{pos ? ` — #${pos.pos} of ${pos.total}` : ""}.</p><p className="mt-1">{l.waitlistEntry.max_price_cents ? `Your maximum: ${aud(l.waitlistEntry.max_price_cents)}. ` : ""}<Link href="/account/waitlists" className="underline">Manage waitlists</Link></p></div>
              ) : <Button asChild variant="gold" size="lg" className="w-full"><Link href={`/waitlist/${l.id}`}>Join the waitlist</Link></Button>
            ) : user && user.role !== "customer" ? (
              <p className="rounded-xl bg-navy-900/5 p-3 text-sm">You&apos;re signed in as a {user.role}. Use a customer account to book.</p>
            ) : (
              <ActionForm action={startCheckoutAction} submit={user ? "Continue to payment" : "Sign in to book"} variant="gold" size="lg" submitClassName="w-full" className="space-y-3">
                <input type="hidden" name="listingId" value={l.id} /><input type="hidden" name="idempotencyKey" value={key} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${label[0].toUpperCase()}${label.slice(1)}s`} htmlFor="quantity"><Select id="quantity" name="quantity">{Array.from({ length: Math.min(l.available_units, l.max_per_booking) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
                  <Field label="Guests" htmlFor="guests"><Input id="guests" name="guests" type="number" min={1} max={50} defaultValue={l.meta?.sleeps ?? l.meta?.partySize ?? 2} /></Field>
                </div>
                <Field label="Guest name" htmlFor="guestName"><Input id="guestName" name="guestName" defaultValue={user?.name} autoComplete="name" required /></Field>
                <Field label="Email for confirmation" htmlFor="guestEmail"><Input id="guestEmail" name="guestEmail" type="email" defaultValue={user?.email} autoComplete="email" required /></Field>
                <Field label="Mobile (optional)" htmlFor="guestPhone"><Input id="guestPhone" name="guestPhone" type="tel" autoComplete="tel" /></Field>
                <Field label="Special requests (optional)" htmlFor="specialRequests"><Textarea id="specialRequests" name="specialRequests" rows={2} maxLength={500} placeholder="Dietary needs, accessibility, arrival time…" /></Field>
                {buybackOffered && (
                  <div className="rounded-xl border border-navy-900/15 p-3 text-sm">
                    <label className="flex items-start gap-2"><input type="checkbox" name="buybackConsent" className="mt-1 size-4 accent-navy-900" /><span><strong>Optional:</strong> let this venue ask me if I&apos;d release this booking for a full refund <em>plus</em> extra compensation.</span></label>
                    <details className="mt-2 text-xs text-navy-900/70"><summary className="cursor-pointer font-medium underline">Exactly what I&apos;m agreeing to</summary><p className="mt-1">{buybackOptInText(terms)}</p></details>
                  </div>
                )}
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required className="mt-1 size-4 accent-navy-900" /><span>I&apos;ve read the <a href="#terms" className="underline">cancellation terms</a> and the total price above, and accept the <Link href="/legal/terms" className="underline">Terms</Link>.</span></label>
              </ActionForm>
            )}
            <p className="flex items-center gap-1.5 text-xs text-navy-900/55"><ShieldCheck className="size-3.5" />Payments by Stripe. Held for 10 minutes while you pay. Starts {fmtDate(l.starts_at)}.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
