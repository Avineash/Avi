import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Select, StatusBadge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDateTime } from "@/lib/util";
import { openDisputeAction, refundRequestAction, resolveDisputeAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Disputes & refunds" };

export default async function Disputes() {
  await requirePermission("admin:finance", "/admin/disputes");
  const db = await getDb();
  const reqs = (await db.query<any>("select rr.*, r.reference, r.total_cents, u.email, l.title from refund_requests rr join reservations r on r.id = rr.reservation_id join users u on u.id = rr.requested_by join listings l on l.id = r.listing_id where rr.status = 'pending' order by rr.created_at")).rows;
  const ds = (await db.query<any>("select d.*, r.reference, l.title, p.business_name from disputes d join reservations r on r.id = d.reservation_id join listings l on l.id = r.listing_id join partners p on p.id = r.partner_id order by (d.status in ('open','investigating')) desc, d.created_at desc limit 50")).rows;
  return (
    <>
      <PageHeader title="Disputes & refunds" eyebrow="Trust & safety" />
      <section aria-labelledby="rr"><h2 id="rr" className="mb-3 text-xl font-semibold">Exceptional refund requests</h2>
        {reqs.length === 0 ? <EmptyState title="No pending requests" /> : <ul className="space-y-3">{reqs.map((r) => (
          <Card key={r.id} className="p-5"><div className="flex flex-wrap justify-between gap-4"><div><p className="font-semibold">{r.title} <span className="font-mono text-xs">({r.reference})</span></p><p className="text-sm">{r.email} requests <strong>{aud(r.amount_cents)}</strong> of {aud(r.total_cents)}</p><p className="mt-1 max-w-xl text-sm italic text-navy-900/75">“{r.reason}”</p><p className="mt-1 text-xs text-navy-900/50">Consider the consumer guarantees under the ACL, not just the listing&apos;s change-of-mind terms.</p></div>
            <ActionForm action={refundRequestAction} hideSubmit className="flex flex-col items-end gap-2"><input type="hidden" name="requestId" value={r.id} /><Input name="note" placeholder="Decision note" aria-label="Decision note" className="h-9 w-56" /><div className="flex gap-2"><Button name="approve" value="true" size="sm" variant="gold">Approve &amp; refund</Button><Button name="approve" value="false" size="sm" variant="outline">Decline</Button></div></ActionForm></div></Card>))}</ul>}
      </section>
      <section aria-labelledby="dd" className="mt-10 grid gap-6 xl:grid-cols-[1.4fr_1fr]"><div><h2 id="dd" className="mb-3 text-xl font-semibold">Disputes, chargebacks &amp; fraud</h2>
        {ds.length === 0 ? <EmptyState title="No disputes" /> : <ul className="space-y-3">{ds.map((d) => (
          <Card key={d.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold capitalize">{d.kind} · {aud(d.amount_cents)} <StatusBadge status={d.status} /></p><p className="text-sm text-navy-900/70">{d.title} ({d.reference}) · {d.business_name} · opened {fmtDateTime(d.created_at)}</p>{d.notes && <p className="text-sm">{d.notes}</p>}{d.resolution && <p className="text-sm text-navy-900/60">Resolution: {d.resolution}</p>}</div>
            {["open", "investigating"].includes(d.status) && <ActionForm action={resolveDisputeAction} hideSubmit className="flex flex-col gap-2"><input type="hidden" name="disputeId" value={d.id} /><Input name="resolution" placeholder="Resolution notes" aria-label="Resolution" required className="h-9 w-56" /><div className="flex gap-1"><Button name="outcome" value="won" size="sm" variant="outline">Won</Button><Button name="outcome" value="lost" size="sm" variant="danger">Lost</Button><Button name="outcome" value="closed" size="sm" variant="ghost">Close</Button></div></ActionForm>}</div></Card>))}</ul>}</div>
        <Card><CardHeader><CardTitle>Open a case</CardTitle></CardHeader><CardBody><ActionForm action={openDisputeAction} submit="Open case" variant="outline" className="space-y-3"><Field label="Booking reference" htmlFor="ref"><Input id="ref" name="reference" required placeholder="RS-XXXXXXXX" /></Field><Field label="Type" htmlFor="kind"><Select id="kind" name="kind"><option value="dispute">Customer dispute</option><option value="chargeback">Chargeback</option><option value="fraud">Fraud investigation</option></Select></Field><Field label="Amount at risk ($, blank = full)" htmlFor="amt"><Input id="amt" name="amount" inputMode="decimal" /></Field><Field label="Notes" htmlFor="notes"><Input id="notes" name="notes" required /></Field></ActionForm><p className="mt-3 text-xs text-navy-900/60">Lost chargebacks are debited from the partner ledger and reverse the platform&apos;s fee on that amount. Stripe dispute webhooks open cases automatically.</p></CardBody></Card></section>
    </>
  );
}
