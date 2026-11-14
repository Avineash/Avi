import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { describeRule } from "@/lib/domain/fees";
import { featureOn } from "@/lib/domain/settings";
import { getSeller, resaleRules, TRANSFER_LABEL } from "@/lib/domain/resale";
import { toLocalInput } from "@/lib/util";
import { createResaleListingAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "List a booking" };

export default async function NewListing() {
  const user = await requireUser("/sell/new");
  const db = await getDb();
  const seller = await getSeller(db, user.id);
  if (!seller) redirect("/sell/setup?next=/sell/new");
  const open = await featureOn(db, "features.peer_resale");
  const rules = await resaleRules(db);
  const rule = (await db.query<any>("select * from fee_rules where active and payer = 'seller' and applies_to = 'peer_resale' and scope = 'global'")).rows[0];
  const venues = (await db.query<any>(
    `select v.id, v.name, v.suburb, v.category, v.max_markup_bps, v.transfer_instructions from venues v join partners p on p.id = v.partner_id
      where p.status = 'approved' and v.status = 'active' and v.resale_allowed order by v.category, v.name`)).rows;
  const t = (h: number) => toLocalInput(new Date(Date.now() + h * 3_600_000));
  return (
    <div className="container-page max-w-5xl py-10">
      <p className="eyebrow">Sell</p><h1 className="h-section mt-2">List a booking or ticket</h1>
      {seller.status !== "active" && <p role="alert" className="mt-4 rounded-xl bg-danger/10 p-4 text-sm text-danger">Your selling privileges are suspended. Contact support.</p>}
      {!open && <p role="alert" className="mt-4 rounded-xl border border-gold-500/40 bg-gold-300/20 p-4 text-sm">Resale isn&apos;t open yet — it switches on once legal review is complete. You can prepare, but listing is disabled.</p>}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <Card><CardBody className="p-7">
          <ActionForm action={createResaleListingAction} submit="Publish listing" variant="gold" size="lg" className="space-y-6">
            <Field label="Venue (registered venues only)" htmlFor="venueId" hint="Each venue sets its own resale cap. Not listed? It isn't registered with Eleventh Hour, so it can't be resold here.">
              <Select id="venueId" name="venueId" required>{venues.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.suburb} ({v.category}; resale cap {(v.max_markup_bps / 100).toFixed(0)}% of what you paid)</option>)}</Select></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="title"><Input id="title" name="title" required placeholder="Deluxe King · 1 night" /></Field>
              <Field label="Details" htmlFor="itemDetail"><Input id="itemDetail" name="itemDetail" placeholder="1 King · city view · breakfast included" /></Field>
            </div>
            <Field label="Description (optional)" htmlFor="description"><Textarea id="description" name="description" rows={3} maxLength={2000} /></Field>
            <fieldset className="grid gap-4 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">When (Melbourne time)</legend>
              <Field label="Starts / check-in" htmlFor="startsAt" hint={`At least ${rules.cutoff_hours_before_start}h from now.`}><Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={t(30)} required /></Field>
              <Field label="Ends / check-out" htmlFor="endsAt"><Input id="endsAt" name="endsAt" type="datetime-local" defaultValue={t(48)} required /></Field>
              <Field label="Quantity" htmlFor="quantity"><Input id="quantity" name="quantity" type="number" min={1} max={20} defaultValue={1} /></Field></fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold">Price (AUD, per unit)</legend>
              <Field label="What you paid" htmlFor="original" hint="Face value, as on your confirmation."><Input id="original" name="original" inputMode="decimal" required /></Field>
              <Field label="Your asking price" htmlFor="ask" hint="Can't exceed the venue's cap shown above."><Input id="ask" name="ask" inputMode="decimal" required /></Field></fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold">Transfer</legend>
              <Field label="How will you transfer it?" htmlFor="transferMethod"><Select id="transferMethod" name="transferMethod">{Object.entries(TRANSFER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Booking / confirmation reference" htmlFor="bookingReference" hint="Kept private; used to stop the same booking being listed twice."><Input id="bookingReference" name="bookingReference" required minLength={4} /></Field>
              <Field label="Notes for the buyer" htmlFor="transferNotes" className="sm:col-span-2"><Textarea id="transferNotes" name="transferNotes" rows={2} maxLength={600} placeholder="e.g. I'll change the booking name via the hotel; you'll get a new confirmation email." /></Field>
              <Field label="Proof of purchase (PDF, PNG or JPEG, max 5 MB)" htmlFor="proof" className="sm:col-span-2" hint="Your booking confirmation or ticket. Held privately by Eleventh Hour — never shown to buyers."><Input id="proof" name="proof" type="file" accept="application/pdf,image/png,image/jpeg" required className="py-2" /></Field></fieldset>
            <fieldset className="space-y-2 rounded-2xl border border-navy-900/15 p-4 text-sm"><legend className="px-1 font-semibold">Seller declarations</legend>
              {[["holder", "I am the person who holds this booking / ticket."], ["permitted", "I'm permitted to transfer it, and I'm not breaching the venue's or ticket-seller's terms."], ["deliver", `I will deliver within ${rules.delivery_hours} hours of a sale, or the buyer is refunded and I receive a strike.`], ["accurate", "Everything I've entered is accurate."]].map(([k, v]) => <label key={k} className="flex items-start gap-2"><input type="checkbox" name={k} required className="mt-1 size-4 accent-navy-900" />{v}</label>)}
            </fieldset>
          </ActionForm>
        </CardBody></Card>
        <aside className="space-y-4 text-sm">
          <Card className="p-5"><h2 className="text-lg">What you&apos;ll earn</h2><p className="mt-2 text-navy-900/75">{rule ? `We deduct ${describeRule(rule)} of the sale price when it sells. ` : ""}Buyers pay their own service fee on top, so it never comes out of your price.</p><p className="mt-2 text-xs text-navy-900/55">Example: sell for $200 → you receive $184 once the buyer confirms (at the default 8% fee).</p></Card>
          <Card className="p-5"><h2 className="text-lg">Good to know</h2><ul className="mt-2 list-disc space-y-1.5 pl-5 text-navy-900/75"><li>Money is held in escrow, then released when the buyer confirms or {rules.release_after_start_hours}h after the event.</li><li>Cancelling a sale after it&apos;s paid gives you a strike.</li><li>Listings close {rules.cutoff_hours_before_start}h before the start.</li></ul><p className="mt-3"><Link href="/legal/terms" className="underline">Seller Terms</Link></p></Card>
        </aside>
      </div>
    </div>
  );
}
