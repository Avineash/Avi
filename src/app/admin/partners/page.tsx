import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Input, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fmtDateTime } from "@/lib/util";
import { partnerStatusAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Partner approvals" };

export default async function Partners({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  await requirePermission("admin:partners", "/admin/partners");
  const db = await getDb();
  const rows = (await db.query<any>(
    `select p.*, u.email, (select count(*)::int from listings where partner_id = p.id) as listings, (select count(*)::int from reservations where partner_id = p.id and status in ('confirmed','completed')) as bookings
       from partners p join users u on u.id = p.owner_user_id ${status ? "where p.status = $1" : ""} order by case p.status when 'pending' then 0 else 1 end, p.created_at desc`, status ? [status] : [])).rows;
  const docs = (await db.query<any>("select id, partner_id, doc_type, file_name, status, created_at from partner_verifications order by created_at")).rows;
  return (
    <>
      <PageHeader title="Partner approvals" eyebrow="Verification">{["", "pending", "approved", "suspended", "rejected"].map((s) => <Button key={s} asChild size="sm" variant={(status ?? "") === s ? "default" : "outline"}><Link href={s ? `/admin/partners?status=${s}` : "/admin/partners"}>{s || "All"}</Link></Button>)}</PageHeader>
      {rows.length === 0 ? <EmptyState title="No partners" /> : (
        <ul className="space-y-4">{rows.map((p) => (
          <Card key={p.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4">
            <div><div className="flex items-center gap-2"><h2 className="font-serif text-lg font-semibold">{p.business_name}</h2><StatusBadge status={p.status} />{p.is_demo && <Badge tone="gold">demo</Badge>}</div>
              <p className="text-sm text-navy-900/70 capitalize">{p.category} · ABN {p.abn} · {p.gst_registered ? "GST registered" : "no GST"} · {p.email}</p><p className="text-xs text-navy-900/50">Applied {fmtDateTime(p.created_at)} · {p.listings} listings · {p.bookings} bookings · buyback {p.buyback_enabled ? "on" : "off"}</p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">{docs.filter((d) => d.partner_id === p.id).map((d) => <li key={d.id}><a className="rounded-full border border-navy-900/20 px-2.5 py-1 hover:bg-navy-900/5" href={`/api/admin/doc/${d.id}`}>{d.doc_type.replace(/_/g, " ")} · {d.file_name} ({d.status})</a></li>)}</ul></div>
            <ActionForm action={partnerStatusAction} hideSubmit className="flex flex-col items-end gap-2"><input type="hidden" name="partnerId" value={p.id} />
              <Input name="note" placeholder="Note to partner (optional)" aria-label="Note to partner" className="h-9 w-64" />
              <div className="flex gap-2">{p.status !== "approved" && <Button name="status" value="approved" size="sm" variant="gold">Approve</Button>}{p.status !== "suspended" && p.status === "approved" && <Button name="status" value="suspended" size="sm" variant="danger">Suspend</Button>}{p.status === "pending" && <Button name="status" value="rejected" size="sm" variant="outline">Reject</Button>}</div></ActionForm>
          </div></Card>))}</ul>)}
    </>
  );
}
