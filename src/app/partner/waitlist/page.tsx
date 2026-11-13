import type { Metadata } from "next";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { WAITLIST_POLICY_TEXT } from "@/lib/domain/waitlist";
import { aud, fmtDateTime } from "@/lib/util";

export const metadata: Metadata = { title: "Waitlist demand" };

export default async function WaitlistDemand() {
  const u = await requirePermission("partner:portal", "/partner/waitlist");
  const db = await getDb();
  const pol = (await db.query<any>("select waitlist_policy from partners where id = $1", [u.partnerId])).rows[0].waitlist_policy;
  const ls = (await db.query<any>(
    `select l.id, l.title, l.starts_at, l.current_price_cents, a.available_units, a.total_units, count(w.*)::int as n, max(w.max_price_cents) as top, avg(w.max_price_cents)::int as avg_max
       from listings l join listing_availability a on a.listing_id = l.id join waitlist_entries w on w.listing_id = l.id and w.status in ('active','offered')
      where l.partner_id = $1 group by l.id, a.available_units, a.total_units order by n desc`, [u.partnerId])).rows;
  const entries = (await db.query<any>(
    `select w.*, u.name from waitlist_entries w join users u on u.id = w.customer_id join listings l on l.id = w.listing_id where l.partner_id = $1 and w.status in ('active','offered') order by w.created_at`, [u.partnerId])).rows;
  return (
    <>
      <PageHeader title="Waitlist demand" eyebrow="Unmet demand" />
      <p className="mb-6 max-w-3xl rounded-xl bg-ivory-200 p-4 text-sm"><strong>Your published policy:</strong> {WAITLIST_POLICY_TEXT[pol]} Change it in Business settings. Customers see this policy before joining.</p>
      {ls.length === 0 ? <EmptyState title="No one is on a waitlist for your listings" /> : (
        <ul className="space-y-4">{ls.map((l) => (
          <li key={l.id} className="card p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-serif text-lg font-semibold">{l.title}</h2><p className="text-sm text-navy-900/60">{fmtDateTime(l.starts_at)} · listed {aud(l.current_price_cents)} · {l.available_units}/{l.total_units} available</p></div><div className="text-right text-sm"><p><strong>{l.n}</strong> waiting</p>{l.top && <p className="text-navy-900/70">top max {aud(l.top)} · avg max {aud(l.avg_max)}</p>}{l.top > l.current_price_cents && <Badge tone="gold">Demand above your price</Badge>}</div></div>
            <ol className="mt-3 divide-y divide-navy-900/10 text-sm">{entries.filter((e) => e.listing_id === l.id).map((e, i) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{i + 1}. {e.name.split(" ")[0]} {e.name.split(" ")[1]?.[0] ?? ""}. · {e.preferences?.guests ?? 1} guest(s){e.preferences?.time ? ` · ${e.preferences.time}` : ""}{e.preferences?.note ? ` · “${e.preferences.note}”` : ""}</span><span className="text-navy-900/70">max {e.max_price_cents ? aud(e.max_price_cents) : "listed price"} · joined {fmtDateTime(e.created_at)} {e.status === "offered" && <Badge tone="warn">offer out</Badge>}</span></li>)}</ol></li>))}</ul>)}
      <p className="mt-6 text-xs text-navy-900/60">Customer contact details are never shared from waitlists — offers go through the platform.</p>
    </>
  );
}
