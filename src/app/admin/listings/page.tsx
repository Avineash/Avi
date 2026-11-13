import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";
import { listingAdminAction, promotionAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Listings & inventory" };

export default async function AdminListings() {
  await requirePermission("admin:portal", "/admin/listings");
  const db = await getDb();
  const rows = (await db.query<any>(
    `select l.id, l.title, l.category, l.status, l.featured, l.starts_at, l.current_price_cents, v.name as venue, p.business_name, a.total_units, a.available_units, a.booked_units, a.held_units, a.offered_units,
            (select count(*)::int from waitlist_entries w where w.listing_id = l.id and w.status in ('active','offered')) as wl,
            (select label from promotions pr where pr.listing_id = l.id and pr.active and pr.ends_at > now() limit 1) as promo
       from listings l join venues v on v.id = l.venue_id join partners p on p.id = l.partner_id join listing_availability a on a.listing_id = l.id order by l.starts_at desc limit 150`)).rows;
  const states = (await db.query<any>("select status, count(*)::int n from inventory_units group by 1 order by 2 desc")).rows;
  return (
    <>
      <PageHeader title="Listings & inventory" eyebrow="Marketplace supply" />
      <div className="mb-6 flex flex-wrap gap-2">{states.map((s) => <Badge key={s.status} tone="neutral">{s.status.replace(/_/g, " ")}: {s.n}</Badge>)}</div>
      <Card className="mb-6"><CardHeader><CardTitle>Add a promotion / featured placement</CardTitle></CardHeader><CardBody>
        <ActionForm action={promotionAction} submit="Add promotion" size="sm" variant="gold" className="flex flex-wrap items-end gap-3">
          <Field label="Listing" htmlFor="listingId"><Select id="listingId" name="listingId" className="w-72">{rows.filter((r) => r.status === "published").map((r) => <option key={r.id} value={r.id}>{r.title} — {r.venue}</option>)}</Select></Field>
          <Field label="Badge label" htmlFor="label"><Input id="label" name="label" defaultValue="Editor's pick" className="w-44" /></Field><Field label="Days" htmlFor="days"><Input id="days" name="days" type="number" defaultValue={3} min={1} max={60} className="w-24" /></Field></ActionForm></CardBody></Card>
      <div className="card p-2"><Table><thead><tr><TH>Listing</TH><TH>Partner</TH><TH>Starts</TH><TH>Price</TH><TH>Units</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><TD><p className="font-medium">{r.title}</p><p className="text-xs text-navy-900/60 capitalize">{r.category} · {r.venue}</p></TD><TD className="text-xs">{r.business_name}</TD><TD>{fmtDateTime(r.starts_at)}</TD><TD>{aud(r.current_price_cents, { whole: true })}</TD>
          <TD className="text-xs">{r.available_units} avail · {r.booked_units} sold · {r.held_units} held · {r.offered_units} offered<br />{r.wl} on waitlist</TD><TD><StatusBadge status={r.status} />{r.featured && <Badge tone="gold" className="ml-1">featured</Badge>}{r.promo && <Badge tone="gold" className="ml-1">{r.promo}</Badge>}</TD>
          <TD><form action={listingAdminAction} className="flex gap-1"><input type="hidden" name="listingId" value={r.id} />{r.status === "published" ? <Button name="op" value="pause" size="sm" variant="outline">Pause</Button> : <Button name="op" value="publish" size="sm" variant="outline">Publish</Button>}<Button name="op" value={r.featured ? "unfeature" : "feature"} size="sm" variant="ghost">{r.featured ? "Unfeature" : "Feature"}</Button></form></TD></tr>)}
      </tbody></Table></div>
    </>
  );
}
