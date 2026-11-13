import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { toLocalInput } from "@/lib/util";
import { createListingAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "New listing" };

export default async function NewListing() {
  const u = await requirePermission("partner:portal", "/partner/inventory/new");
  const db = await getDb();
  const venues = (await db.query<any>("select id, name, category from venues where partner_id = $1 order by name", [u.partnerId])).rows;
  const cat = u.partnerCategory ?? "hotel";
  const noun = cat === "hotel" ? "rooms" : cat === "restaurant" ? "tables" : "tickets";
  const t = (h: number) => toLocalInput(new Date(Date.now() + h * 3_600_000));
  if (u.partnerStatus !== "approved") return <EmptyState title="Publishing unlocks once you're approved" />;
  if (venues.length === 0) return <EmptyState title="Add a venue first"><Link className="underline" href="/partner/settings">Go to Business settings</Link></EmptyState>;
  return (
    <>
      <PageHeader title="New listing" eyebrow="Publish unsold inventory" />
      <Card><CardBody className="p-6">
        <ActionForm action={createListingAction} submit="Create listing" variant="gold" size="lg" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Venue" htmlFor="venueId"><Select id="venueId" name="venueId">{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
            <Field label="Title" htmlFor="title"><Input id="title" name="title" required placeholder={cat === "hotel" ? "Deluxe King" : cat === "restaurant" ? "Chef's tasting menu for two" : "Friday night showcase"} /></Field>
            <Field label="Details line" htmlFor="subcategory"><Input id="subcategory" name="subcategory" placeholder={cat === "hotel" ? "1 King · 28 m² · sleeps 2" : "7 courses · wine pairing"} /></Field>
            <Field label="Image URL (optional)" htmlFor="imageUrl" hint="Paste a link to your professional photography. A designed cover is generated otherwise."><Input id="imageUrl" name="imageUrl" type="url" placeholder="https://" /></Field>
          </div>
          <Field label="Description" htmlFor="description"><Textarea id="description" name="description" rows={3} /></Field>
          <fieldset className="grid gap-4 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">When (Melbourne time)</legend>
            <Field label={cat === "hotel" ? "Check-in" : "Starts"} htmlFor="startsAt"><Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={t(6)} required /></Field>
            <Field label={cat === "hotel" ? "Check-out" : "Ends"} htmlFor="endsAt"><Input id="endsAt" name="endsAt" type="datetime-local" defaultValue={t(27)} required /></Field>
            <Field label="Booking deadline" htmlFor="bookingDeadline" hint="Sales stop at this time."><Input id="bookingDeadline" name="bookingDeadline" type="datetime-local" defaultValue={t(5)} required /></Field></fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-4"><legend className="mb-2 text-sm font-semibold">Pricing (AUD, GST-inclusive)</legend>
            <Field label="Original / rack price" htmlFor="original" hint="Shown struck-through."><Input id="original" name="original" inputMode="decimal" required /></Field>
            <Field label="Selling price" htmlFor="price"><Input id="price" name="price" inputMode="decimal" required /></Field>
            <Field label="Minimum price" htmlFor="min" hint="Never sold below this."><Input id="min" name="min" inputMode="decimal" required /></Field>
            <Field label="Maximum price" htmlFor="max"><Input id="max" name="max" inputMode="decimal" required /></Field></fieldset>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={`Number of ${noun}`} htmlFor="units"><Input id="units" name="units" type="number" min={1} max={500} defaultValue={cat === "event" ? 20 : 3} /></Field>
            <Field label="Max per booking" htmlFor="maxPerBooking"><Input id="maxPerBooking" name="maxPerBooking" type="number" min={1} max={10} defaultValue={cat === "event" ? 6 : 2} /></Field>
            <Field label="Cancellation policy" htmlFor="cancellationPolicy"><Select id="cancellationPolicy" name="cancellationPolicy" defaultValue="flexible"><option value="flexible">Flexible — full refund until 4h before</option><option value="moderate">Moderate — full ≥24h, 50% ≥4h</option><option value="strict">Strict — 50% ≥24h</option><option value="non_refundable">Non-refundable</option></Select></Field>
            <Field label="Pricing mode" htmlFor="pricingMode"><Select id="pricingMode" name="pricingMode" defaultValue="manual"><option value="manual">Manual (my price)</option><option value="auto">Auto (rule-based within my min/max)</option></Select></Field>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2"><input type="checkbox" name="buybackEligible" className="mt-1 size-4 accent-navy-900" /><span>Allow eligible buyback offers on this listing (customers must still opt in, and the feature must be enabled platform-wide).</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" name="publish" defaultChecked className="size-4 accent-navy-900" />Publish immediately</label>
          </div>
        </ActionForm>
      </CardBody></Card>
    </>
  );
}
