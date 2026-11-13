import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fmtDateTime } from "@/lib/util";
import { createVenueAction, updateBuybackRulesAction, uploadDocAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "Business settings" };

export default async function Settings() {
  const u = await requirePermission("partner:portal", "/partner/settings");
  const db = await getDb();
  const p = (await db.query<any>("select * from partners where id = $1", [u.partnerId])).rows[0];
  const venues = (await db.query<any>("select * from venues where partner_id = $1 order by name", [u.partnerId])).rows;
  const docs = (await db.query<any>("select id, doc_type, file_name, status, notes, created_at from partner_verifications where partner_id = $1 order by created_at desc", [u.partnerId])).rows;
  const cb = (n: string, l: string, on: boolean) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={n} defaultChecked={on} className="size-4 accent-navy-900" />{l}</label>;
  return (
    <>
      <PageHeader title="Business settings" eyebrow={p.business_name}><StatusBadge status={p.status} /></PageHeader>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Business &amp; verification</CardTitle></CardHeader><CardBody className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-3"><div><dt className="text-navy-900/60">ABN</dt><dd className="font-mono">{p.abn}</dd></div><div><dt className="text-navy-900/60">GST</dt><dd>{p.gst_registered ? "Registered" : "Not registered"}</dd></div><div><dt className="text-navy-900/60">Category</dt><dd className="capitalize">{p.category}</dd></div><div><dt className="text-navy-900/60">Payouts</dt><dd>{p.stripe_account_id ? <Badge tone="success">Stripe Connect linked</Badge> : <Badge tone="gold">Sandbox payouts</Badge>}</dd></div></dl>
          <ul className="divide-y divide-navy-900/10">{docs.map((d) => <li key={d.id} className="flex justify-between py-2"><span>{d.file_name} <span className="text-navy-900/50">· {d.doc_type.replace(/_/g, " ")} · {fmtDateTime(d.created_at)}</span></span><StatusBadge status={d.status} /></li>)}</ul>
          <ActionForm action={uploadDocAction} submit="Upload document" size="sm" variant="outline" className="flex flex-wrap items-end gap-3">
            <Field label="Type" htmlFor="docType"><Select id="docType" name="docType"><option value="abn_certificate">ABN registration</option><option value="business_licence">Business licence</option><option value="liquor_licence">Liquor licence</option><option value="insurance">Insurance</option><option value="id_document">Director ID</option><option value="other">Other</option></Select></Field>
            <Field label="File" htmlFor="doc"><Input id="doc" name="doc" type="file" accept="application/pdf,image/png,image/jpeg" className="py-2" /></Field></ActionForm>
        </CardBody></Card>

        <Card id="buyback"><CardHeader><CardTitle>Buyback &amp; waitlist rules</CardTitle></CardHeader><CardBody>
          <ActionForm action={updateBuybackRulesAction} submit="Save rules" className="space-y-4">
            {cb("enabled", "Enable customer-consented buyback for my business", p.buyback_enabled)}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Minimum compensation (% of booking)" htmlFor="minComp"><Input id="minComp" name="minComp" type="number" step="0.5" min={0} max={100} defaultValue={p.buyback_min_comp_bps / 100} /></Field>
              <Field label="Maximum compensation (% of booking)" htmlFor="maxComp"><Input id="maxComp" name="maxComp" type="number" step="0.5" min={0} max={100} defaultValue={p.buyback_max_comp_bps / 100} /></Field>
              <Field label="Admin approval above ($ compensation)" htmlFor="threshold" hint="Larger offers need platform approval first."><Input id="threshold" name="threshold" inputMode="decimal" defaultValue={(p.buyback_approval_threshold_cents / 100).toFixed(2)} /></Field>
              <Field label="No offers within (hours of start)" htmlFor="minNotice"><Input id="minNotice" name="minNotice" type="number" min={0} defaultValue={p.buyback_min_notice_hours} /></Field>
              <Field label="Waitlist offer window (minutes)" htmlFor="offerWindow"><Input id="offerWindow" name="offerWindow" type="number" min={5} max={1440} defaultValue={p.offer_window_minutes} /></Field>
              <Field label="Waitlist priority policy" htmlFor="policy" hint="Shown publicly to customers."><Select id="policy" name="policy" defaultValue={p.waitlist_policy}><option value="first_come">First come, first served</option><option value="highest_offer">Highest offer first</option></Select></Field>
            </div>
          </ActionForm></CardBody></Card>

        <Card className="xl:col-span-2"><CardHeader><CardTitle>Venues</CardTitle></CardHeader><CardBody className="grid gap-6 lg:grid-cols-2">
          <ul className="space-y-2 text-sm">{venues.length === 0 && <li className="text-navy-900/60">No venues yet.</li>}{venues.map((v) => <li key={v.id} className="rounded-xl border border-navy-900/10 p-3"><p className="font-semibold">{v.name}</p><p className="text-navy-900/60">{v.address}, {v.suburb} · {Number(v.lat).toFixed(4)}, {Number(v.lng).toFixed(4)}</p></li>)}</ul>
          <ActionForm action={createVenueAction} submit="Add venue" variant="outline" resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Venue name" htmlFor="vn"><Input id="vn" name="name" required /></Field><Field label="Suburb" htmlFor="vs"><Input id="vs" name="suburb" required /></Field></div>
            <Field label="Street address" htmlFor="va"><Input id="va" name="address" required /></Field>
            <div className="grid gap-3 sm:grid-cols-3"><Field label="City" htmlFor="vc"><Input id="vc" name="city" defaultValue="Melbourne" /></Field><Field label="Latitude" htmlFor="vlat"><Input id="vlat" name="lat" defaultValue="-37.8136" required /></Field><Field label="Longitude" htmlFor="vlng"><Input id="vlng" name="lng" defaultValue="144.9631" required /></Field></div>
            {p.category === "hotel" && <Field label="Star rating" htmlFor="vstar"><Select id="vstar" name="starRating" defaultValue="4"><option value="3">3</option><option value="4">4</option><option value="5">5</option></Select></Field>}
            {p.category === "restaurant" && <Field label="Cuisine" htmlFor="vcu"><Input id="vcu" name="cuisine" /></Field>}
            <Field label="Amenities (comma separated)" htmlFor="vam"><Input id="vam" name="amenities" /></Field>
            <Field label="Image URL" htmlFor="vi"><Input id="vi" name="imageUrl" type="url" /></Field>
            <Field label="Description" htmlFor="vd"><Textarea id="vd" name="description" rows={2} /></Field>
          </ActionForm>
        </CardBody></Card>

        <Card className="xl:col-span-2"><CardHeader><CardTitle>Integrations</CardTitle></CardHeader><CardBody className="text-sm"><p className="text-navy-900/75">Today you manage inventory directly in this portal. The inventory service is built around a stable unit/allocation model so future connectors can sync availability and rates two-way:</p><ul className="mt-3 flex flex-wrap gap-2">{["Property management systems (Opera, Mews)", "Channel managers (SiteMinder, Cloudbeds)", "Restaurant booking (TheFork, SevenRooms)", "Ticketing platforms"].map((x) => <li key={x}><Badge>{x} · planned</Badge></li>)}</ul></CardBody></Card>
      </div>
    </>
  );
}
