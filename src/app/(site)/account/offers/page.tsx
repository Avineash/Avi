import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Countdown } from "@/components/countdown";
import { Badge, Card, CardBody, EmptyState, Field, Input, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/domain/settings";
import { buybackOptInText } from "@/lib/domain/legal";
import { aud, fmtDateTime } from "@/lib/util";
import { respondBuybackAction } from "@/app/actions/account";
import { acceptWaitlistOfferAction, declineWaitlistOfferAction } from "@/app/actions/waitlist";
import { markNotificationsReadAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Offers" };

export default async function Offers() {
  const u = await requirePermission("customer:account", "/account/offers");
  const db = await getDb();
  const wl = (await db.query<any>(
    `select o.*, l.title, l.starts_at, v.name as venue, e.max_price_cents, (select r.cancellation_policy from listings r where r.id = l.id) as policy
       from waitlist_offers o join listings l on l.id = o.listing_id join venues v on v.id = l.venue_id join waitlist_entries e on e.id = o.entry_id
      where o.customer_id = $1 and o.status = 'pending' and o.expires_at > now() order by o.expires_at`, [u.id])).rows;
  const bb = (await db.query<any>(
    `select b.*, l.title, l.starts_at, v.name as venue, r.reference, p.business_name from buyback_offers b join listings l on l.id = b.listing_id join venues v on v.id = l.venue_id
       join reservations r on r.id = b.reservation_id join partners p on p.id = b.partner_id where b.customer_id = $1 and b.status = 'pending_customer' and b.expires_at > now() order by b.expires_at`, [u.id])).rows;
  const hist = (await db.query<any>(
    `select b.id, b.status, b.compensation_cents, b.original_amount_cents, b.responded_at, l.title from buyback_offers b join listings l on l.id = b.listing_id
      where b.customer_id = $1 and b.status not in ('pending_customer','pending_admin') order by b.updated_at desc limit 10`, [u.id])).rows;
  const notes = (await db.query<any>("select * from notifications where user_id = $1 order by created_at desc limit 20", [u.id])).rows;
  const terms = (await getSetting<{ version: string }>(db, "legal.terms_version", { version: "draft" })).version;

  return (
    <>
      <PageHeader title="Offers" eyebrow="Time-limited" />
      <section aria-labelledby="wlo"><h2 id="wlo" className="mb-3 text-xl font-semibold">Waitlist offers</h2>
        {wl.length === 0 ? <EmptyState title="No waitlist offers right now">When a sold-out place opens up for you, it appears here and we&apos;ll notify you.</EmptyState> : (
          <ul className="space-y-4">{wl.map((o) => (
            <Card key={o.id} className="border-gold-500/50 p-5"><div className="flex flex-wrap items-start justify-between gap-4">
              <div><Badge tone="gold">Your turn</Badge><h3 className="mt-2 font-serif text-xl font-semibold">{o.title}</h3><p className="text-sm text-navy-900/70">{o.venue} · {fmtDateTime(o.starts_at)}</p>
                <p className="mt-2 text-lg">Offer price <strong>{aud(o.price_cents)}</strong> <span className="text-sm text-navy-900/60">+ service fee (shown at checkout){o.max_price_cents ? ` · your maximum was ${aud(o.max_price_cents)}` : ""}</span></p></div>
              <div className="text-right"><p className="text-xs text-navy-900/60">Accept within</p><p className="font-serif text-3xl font-semibold text-navy-900"><Countdown to={new Date(o.expires_at).toISOString()} /></p></div>
            </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <ActionForm action={acceptWaitlistOfferAction} submit="Accept & pay" variant="gold"><input type="hidden" name="offerId" value={o.id} /></ActionForm>
                <ActionForm action={declineWaitlistOfferAction} submit="No thanks" variant="outline" confirm="Decline this offer? It will go to the next person."><input type="hidden" name="offerId" value={o.id} /></ActionForm>
              </div></Card>))}</ul>)}
      </section>

      <section aria-labelledby="bbo" className="mt-10"><h2 id="bbo" className="mb-1 text-xl font-semibold">Optional offers on your existing bookings</h2>
        <p className="mb-3 text-sm text-navy-900/70">A venue is asking whether you&apos;d like to give up a booking. <strong>This is entirely optional.</strong> Your booking stays exactly as it is unless you accept — declining or ignoring has no consequence.</p>
        {bb.length === 0 ? <EmptyState title="No offers on your bookings" /> : (
          <ul className="space-y-4">{bb.map((o) => (
            <Card key={o.id} className="p-5"><CardBody className="p-0">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><Badge>Optional</Badge><h3 className="mt-2 font-serif text-xl font-semibold">{o.title}</h3><p className="text-sm text-navy-900/70">{o.venue} · booking {o.reference} · {fmtDateTime(o.starts_at)}</p></div><div className="text-right"><p className="text-xs text-navy-900/60">Offer expires in</p><p className="font-serif text-2xl font-semibold"><Countdown to={new Date(o.expires_at).toISOString()} /></p></div></div>
              <dl className="mt-4 grid gap-3 rounded-xl bg-ivory-100 p-4 text-sm sm:grid-cols-3">
                <div><dt className="text-navy-900/60">Full refund of what you paid</dt><dd className="font-serif text-xl font-semibold">{aud(o.original_amount_cents)}</dd></div>
                <div><dt className="text-navy-900/60">Plus compensation from {o.business_name}</dt><dd className="font-serif text-xl font-semibold text-success">+ {aud(o.compensation_cents)}</dd></div>
                <div><dt className="text-navy-900/60">You would receive in total</dt><dd className="font-serif text-xl font-semibold">{aud(o.original_amount_cents + o.compensation_cents)}</dd></div>
              </dl>
              {o.note_to_customer && <p className="mt-3 text-sm italic text-navy-900/75">“{o.note_to_customer}” — {o.business_name}</p>}
              <p className="mt-3 text-xs text-navy-900/60">If you accept, your booking is cancelled, the refund goes to your original payment method and the compensation is paid separately. Nothing changes until you accept.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ActionForm action={respondBuybackAction} submit="Accept offer" variant="gold" className="space-y-3 rounded-xl border border-navy-900/15 p-4">
                  <input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="decision" value="accept" />
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="understand" required className="mt-1 size-4 accent-navy-900" /><span>I understand my booking will be cancelled and I want to accept this offer.</span></label>
                  <details className="text-xs text-navy-900/60"><summary className="cursor-pointer underline">Terms I&apos;m agreeing to</summary><p className="mt-1">{buybackOptInText(terms)}</p></details>
                </ActionForm>
                <ActionForm action={respondBuybackAction} submit="No thanks — keep my booking" variant="outline" className="space-y-2 rounded-xl border border-navy-900/15 p-4"><input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="decision" value="reject" /><p className="text-sm text-navy-900/70">No penalty, no change to your booking.</p></ActionForm>
              </div>
            </CardBody></Card>))}</ul>)}
        {hist.length > 0 && <ul className="mt-4 space-y-1 text-sm text-navy-900/70">{hist.map((h) => <li key={h.id} className="flex items-center gap-2"><StatusBadge status={h.status} />{h.title} — {aud(h.compensation_cents)} compensation</li>)}</ul>}
      </section>

      <section aria-labelledby="nn" className="mt-10"><div className="mb-3 flex items-center justify-between"><h2 id="nn" className="text-xl font-semibold">Notifications</h2><form action={markNotificationsReadAction}><Button size="sm" variant="ghost">Mark all read</Button></form></div>
        <ul className="divide-y divide-navy-900/10 rounded-2xl bg-white shadow-card">{notes.length === 0 ? <li className="p-4 text-sm text-navy-900/60">Nothing yet.</li> : notes.map((n) => <li key={n.id} className="p-4 text-sm"><p className={n.read_at ? "" : "font-semibold"}>{n.title}</p><p className="text-navy-900/70">{n.body}</p><p className="mt-1 text-xs text-navy-900/50">{fmtDateTime(n.created_at)} · email: {n.email_status ?? "queued"}{n.sms_status && n.sms_status !== "skipped" ? ` · sms: ${n.sms_status}` : ""}</p></li>)}</ul>
      </section>
    </>
  );
}
