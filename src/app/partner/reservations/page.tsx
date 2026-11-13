import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { EmptyState, Field, Input, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";
import { partnerRefundAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "Reservations" };

export default async function Reservations() {
  const u = await requirePermission("partner:portal", "/partner/reservations");
  const rows = (await (await getDb()).query<any>(
    `select r.*, l.title, l.starts_at, l.ends_at, u.label, (select coalesce(sum(amount_cents),0) from refunds f where f.reservation_id = r.id and f.status <> 'failed')::int as refunded
       from reservations r join listings l on l.id = r.listing_id join inventory_units u on u.id = r.unit_id where r.partner_id = $1 and r.status not in ('pending_payment','expired') order by l.starts_at desc limit 100`, [u.partnerId])).rows;
  return (
    <>
      <PageHeader title="Reservations" eyebrow="Guests & check-in" />
      {rows.length === 0 ? <EmptyState title="No reservations yet" /> : (
        <div className="card p-2"><Table><thead><tr><TH>Reference</TH><TH>Guest</TH><TH>Listing</TH><TH>Arrives</TH><TH>Price</TH><TH>Status</TH><TH>Actions</TH></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><TD className="font-mono text-xs">{r.reference}</TD>
            <TD><p className="font-medium">{r.guest_name}</p><p className="text-xs text-navy-900/60">{r.guests} guest{r.guests > 1 ? "s" : ""} · {r.guest_email}{r.guest_phone ? ` · ${r.guest_phone}` : ""}</p>{r.special_requests && <p className="text-xs italic">“{r.special_requests}”</p>}</TD>
            <TD>{r.title}<p className="text-xs text-navy-900/60">{r.label}</p></TD><TD>{fmtDateTime(r.starts_at)}</TD><TD>{aud(r.price_cents)}{r.refunded > 0 && <p className="text-xs text-danger">−{aud(r.refunded)} refunded</p>}</TD><TD><StatusBadge status={r.status} /></TD>
            <TD>{["confirmed", "completed"].includes(r.status) && (
              <details><summary className="cursor-pointer text-xs font-semibold underline">Goodwill refund</summary>
                <ActionForm action={partnerRefundAction} submit="Refund" size="sm" variant="outline" className="mt-2 w-56 space-y-2"><input type="hidden" name="reservationId" value={r.id} /><input type="hidden" name="key" value={randomUUID()} />
                  <Field label="Amount ($)" htmlFor={`a-${r.id}`}><Input id={`a-${r.id}`} name="amount" inputMode="decimal" className="h-9" /></Field><Field label="Reason" htmlFor={`w-${r.id}`}><Input id={`w-${r.id}`} name="reason" required minLength={5} className="h-9" /></Field></ActionForm></details>)}</TD></tr>)}
        </tbody></Table></div>)}
    </>
  );
}
