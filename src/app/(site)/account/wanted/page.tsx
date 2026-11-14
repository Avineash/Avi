import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Select, StatusBadge } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDate } from "@/lib/util";
import { cancelAlertAction, createAlertAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "Alerts" };

export default async function Wanted({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const { venue } = await searchParams;
  const u = await requirePermission("customer:account", "/account/wanted");
  const db = await getDb();
  const venues = (await db.query<any>("select v.id, v.name, v.category from venues v join partners p on p.id = v.partner_id where p.status = 'approved' and v.status = 'active' and v.resale_allowed order by v.name")).rows;
  const alerts = (await db.query<any>("select a.*, v.name as venue from buyer_alerts a left join venues v on v.id = a.venue_id where a.buyer_id = $1 and a.status <> 'cancelled' order by a.created_at desc", [u.id])).rows;
  return (
    <>
      <PageHeader title="Alerts" eyebrow="Never miss a listing" />
      <p className="mb-6 max-w-2xl text-sm text-navy-900/75">Sold out or nothing listed? Tell us what you&apos;re after — a category, a venue, dates and a maximum all-in price — and we&apos;ll notify you the moment a matching listing appears.</p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>New alert</CardTitle></CardHeader><CardBody>
          <ActionForm action={createAlertAction} submit="Save alert" variant="gold" resetOnSuccess className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category" htmlFor="category"><Select id="category" name="category"><option value="">Any</option><option value="hotel">Hotel stay</option><option value="restaurant">Dining</option><option value="event">Event</option></Select></Field>
              <Field label="Specific venue" htmlFor="venueId"><Select id="venueId" name="venueId" defaultValue={venue ?? ""}><option value="">Any</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
              <Field label="From" htmlFor="dateFrom"><Input id="dateFrom" name="dateFrom" type="date" /></Field><Field label="To" htmlFor="dateTo"><Input id="dateTo" name="dateTo" type="date" /></Field>
              <Field label="Max price each, all-in ($)" htmlFor="max"><Input id="max" name="max" inputMode="decimal" placeholder="no limit" /></Field>
              <Field label="Quantity" htmlFor="quantity"><Input id="quantity" name="quantity" type="number" min={1} max={20} defaultValue={1} /></Field>
            </div>
            <Field label="Note to yourself (optional)" htmlFor="note"><Input id="note" name="note" maxLength={200} /></Field>
          </ActionForm></CardBody></Card>
        <div>{alerts.length === 0 ? <EmptyState title="No alerts yet" /> : <ul className="space-y-3">{alerts.map((a) => (
          <Card key={a.id} className="flex items-center justify-between gap-3 p-4 text-sm"><div><p className="font-medium capitalize">{a.venue ?? a.category ?? "Anything"}{a.category && a.venue ? ` · ${a.category}` : ""} × {a.quantity}</p><p className="text-navy-900/60">{a.date_from || a.date_to ? `${a.date_from ? fmtDate(a.date_from) : "any"} → ${a.date_to ? fmtDate(a.date_to) : "any"}` : "Any date"} · {a.max_unit_cents ? `up to ${aud(a.max_unit_cents)}` : "any price"}</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={a.status} />{a.status === "active" && <form action={cancelAlertAction}><input type="hidden" name="alertId" value={a.id} /><Button size="sm" variant="ghost">Remove</Button></form>}</div></Card>))}</ul>}</div>
      </div>
    </>
  );
}
