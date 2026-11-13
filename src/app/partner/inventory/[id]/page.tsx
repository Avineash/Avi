import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { LiveAvailability } from "@/components/live-availability";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, StatusBadge, Table, TD, TH, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime, toLocalInput } from "@/lib/util";
import { addUnitsAction, relistUnitAction, releaseToWaitlistAction, updateListingAction, withdrawUnitAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "Manage listing" };

export default async function ManageListing({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requirePermission("partner:portal", `/partner/inventory/${id}`);
  const db = await getDb();
  const l = (await db.query<any>("select l.*, v.name as venue from listings l join venues v on v.id = l.venue_id where l.id = $1", [id])).rows[0];
  if (!l || l.partner_id !== u.partnerId) notFound();
  const units = (await db.query<any>(
    `select u.*, r.reference, r.guest_name, r.status as res_status from inventory_units u
       left join reservations r on r.unit_id = u.id and r.status in ('confirmed','pending_payment','completed') where u.listing_id = $1 order by u.label`, [id])).rows;
  const av = (await db.query<any>("select * from listing_availability where listing_id = $1", [id])).rows[0];
  const wl = Number((await db.query<any>("select count(*)::int n from waitlist_entries where listing_id = $1 and status = 'active'", [id])).rows[0].n);
  const hist = (await db.query<any>("select * from price_history where listing_id = $1 order by id desc limit 8", [id])).rows;
  const events = (await db.query<any>("select e.*, u.label from inventory_events e join inventory_units u on u.id = e.unit_id where u.listing_id = $1 order by e.id desc limit 12", [id])).rows;
  return (
    <>
      <PageHeader title={l.title} eyebrow={l.venue}><StatusBadge status={l.status} /><LiveAvailability listingId={id} initial={{ available: av.available_units, total: av.total_units }} /></PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Units &amp; allocation</CardTitle><p className="text-sm text-navy-900/60">Every unit has its own status and audit trail. Booked units can only change hands through a customer-consented buyback.</p></CardHeader><CardBody>
            <Table><thead><tr><TH>Unit</TH><TH>Status</TH><TH>Booking</TH><TH><span className="sr-only">Actions</span></TH></tr></thead><tbody>
              {units.map((x) => (
                <tr key={x.id}><TD className="font-medium">{x.label}</TD><TD><StatusBadge status={x.status} />{x.reserved_until && <p className="text-xs text-navy-900/60">hold until {fmtDateTime(x.reserved_until)}</p>}</TD><TD className="text-xs">{x.reference ? <>{x.reference}<br />{x.guest_name}</> : "—"}</TD>
                  <TD>{(x.status === "available" || x.status === "cancelled") && (
                    <div className="flex flex-wrap gap-1">
                      {wl > 0 && <ActionForm action={releaseToWaitlistAction} submit="Release to waitlist" size="sm" variant="gold" className="flex items-center gap-1"><input type="hidden" name="unitId" value={x.id} /></ActionForm>}
                      {x.status === "available" && <form action={withdrawUnitAction}><input type="hidden" name="unitId" value={x.id} /><Button size="sm" variant="outline">Withdraw</Button></form>}
                      {x.status === "cancelled" && <form action={relistUnitAction}><input type="hidden" name="unitId" value={x.id} /><Button size="sm" variant="outline">Relist</Button></form>}
                    </div>)}</TD></tr>))}
            </tbody></Table>
            <ActionForm action={addUnitsAction} submit="Add units" size="sm" variant="outline" className="mt-4 flex items-end gap-3"><input type="hidden" name="listingId" value={id} /><Field label="Add more units" htmlFor="count"><Input id="count" name="count" type="number" min={1} max={100} defaultValue={1} className="w-28" /></Field></ActionForm>
            <p className="mt-3 text-xs text-navy-900/60">“Release to waitlist” is the simple alternative to buyback: genuinely unsold or voluntarily cancelled inventory goes straight to the next person on your {wl}-strong waitlist, per your published policy.</p>
          </CardBody></Card>
          <Card><CardHeader><CardTitle>Recent inventory activity</CardTitle></CardHeader><CardBody><ul className="space-y-1 text-xs">{events.map((e) => <li key={e.id} className="flex justify-between gap-3"><span><strong>{e.label}</strong>: {e.from_status ?? "∅"} → {e.to_status}{e.reason ? ` — ${e.reason}` : ""}</span><span className="text-navy-900/50">{fmtDateTime(e.created_at)}</span></li>)}</ul></CardBody></Card>
        </div>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Listing details</CardTitle></CardHeader><CardBody>
            <ActionForm action={updateListingAction} submit="Save changes" className="space-y-4"><input type="hidden" name="listingId" value={id} />
              <Field label="Title" htmlFor="title"><Input id="title" name="title" defaultValue={l.title} required /></Field>
              <Field label="Description" htmlFor="description"><Textarea id="description" name="description" defaultValue={l.description ?? ""} rows={3} /></Field>
              <Field label="Image URL" htmlFor="imageUrl"><Input id="imageUrl" name="imageUrl" type="url" defaultValue={l.image_url?.startsWith("http") ? l.image_url : ""} placeholder="https://" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Minimum price ($)" htmlFor="min"><Input id="min" name="min" defaultValue={(l.min_price_cents / 100).toFixed(2)} /></Field><Field label="Maximum price ($)" htmlFor="max"><Input id="max" name="max" defaultValue={(l.max_price_cents / 100).toFixed(2)} /></Field></div>
              <Field label="Booking deadline" htmlFor="bookingDeadline"><Input id="bookingDeadline" name="bookingDeadline" type="datetime-local" defaultValue={toLocalInput(l.booking_deadline)} /></Field>
              <Field label="Cancellation policy" htmlFor="cancellationPolicy"><Select id="cancellationPolicy" name="cancellationPolicy" defaultValue={l.cancellation_policy}><option value="flexible">Flexible</option><option value="moderate">Moderate</option><option value="strict">Strict</option><option value="non_refundable">Non-refundable</option></Select></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="buybackEligible" defaultChecked={l.buyback_eligible} className="size-4 accent-navy-900" />Eligible for customer buyback offers</label>
              <p className="text-xs text-navy-900/60">Changing terms affects new bookings only — existing bookings keep the terms they were sold under.</p>
            </ActionForm></CardBody></Card>
          <Card><CardHeader><CardTitle>Price history</CardTitle></CardHeader><CardBody><ul className="space-y-1 text-sm">{hist.map((h) => <li key={h.id} className="flex justify-between"><span>{aud(h.price_cents)} <span className="text-xs text-navy-900/50">({h.source})</span></span><span className="text-xs text-navy-900/50">{fmtDateTime(h.created_at)}</span></li>)}</ul><Link href="/partner/pricing" className="mt-2 inline-block text-sm font-semibold underline">Pricing tools</Link></CardBody></Card>
        </div>
      </div>
    </>
  );
}
