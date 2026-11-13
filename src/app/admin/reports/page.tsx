import type { Metadata } from "next";
import { BarChart, moneyLabel, Stat, pct } from "@/components/charts";
import { Card, CardBody, CardHeader, CardTitle, PageHeader, Table, TD, TH } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { adminStats } from "@/lib/domain/analytics";
import { aud } from "@/lib/util";

export const metadata: Metadata = { title: "Reports & analytics" };

export default async function Reports() {
  await requirePermission("admin:finance", "/admin/reports");
  const db = await getDb();
  const s = await adminStats(db, 90);
  const gst = (await db.query<any>(
    `select to_char(created_at at time zone 'Australia/Melbourne','YYYY-MM') m, kind, coalesce(sum(amount_cents),0)::bigint amt, coalesce(sum(gst_cents),0)::bigint gst from platform_fees group by 1,2 order by 1 desc, 2`)).rows;
  const partners = (await db.query<any>(
    `select p.business_name, p.category, count(r.*) filter (where r.status in ('confirmed','completed'))::int bookings, coalesce(sum(r.price_cents) filter (where r.status in ('confirmed','completed')),0)::bigint gbv,
            (select coalesce(sum(amount_cents),0)::bigint from platform_fees f where f.partner_id = p.id and f.kind in ('commission','buyback_fee','resale_fee')) comm
       from partners p left join reservations r on r.partner_id = p.id where p.status = 'approved' group by p.id order by gbv desc`)).rows;
  const conv = (await db.query<any>("select count(*) filter (where status = 'paid')::int paid, count(*)::int total from orders")).rows[0];
  return (
    <>
      <PageHeader title="Reports & analytics" eyebrow="Last 90 days"><Button asChild size="sm" variant="outline"><a href="/api/admin/export?type=fees">Export fees (CSV)</a></Button><Button asChild size="sm" variant="outline"><a href="/api/admin/export?type=reservations">Export bookings (CSV)</a></Button></PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="GBV" value={aud(s.gbv, { whole: true })} /><Stat label="Platform revenue" value={aud(s.platformRevenue, { whole: true })} tone="gold" /><Stat label="Take rate" value={s.gbv ? pct(s.platformRevenue / s.gbv) : "—"} /><Stat label="Checkout completion" value={conv.total ? pct(conv.paid / conv.total) : "—"} hint={`${conv.paid}/${conv.total} orders paid`} /></div>
      <Card className="mt-6"><CardHeader><CardTitle>Gross booking value by day</CardTitle></CardHeader><CardBody><BarChart title="GBV by day" data={s.series.map((d) => ({ label: d.day, value: d.gbv }))} valueLabel={moneyLabel} /></CardBody></Card>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Platform fees & GST (BAS support)</CardTitle></CardHeader><CardBody><Table><thead><tr><TH>Month</TH><TH>Fee type</TH><TH className="text-right">Fees (incl. GST)</TH><TH className="text-right">GST</TH></tr></thead><tbody>{gst.map((g, i) => <tr key={i}><TD>{g.m}</TD><TD className="capitalize">{g.kind.replace(/_/g, " ")}</TD><TD className="text-right tabular-nums">{aud(g.amt)}</TD><TD className="text-right tabular-nums">{aud(g.gst)}</TD></tr>)}</tbody></Table><p className="mt-2 text-xs text-navy-900/60">Negative rows are fee reversals on refunds. Have your accountant confirm GST treatment (including agent/principal analysis) before lodging.</p></CardBody></Card>
        <Card><CardHeader><CardTitle>Partner performance</CardTitle></CardHeader><CardBody><Table><thead><tr><TH>Partner</TH><TH className="text-right">Bookings</TH><TH className="text-right">GBV</TH><TH className="text-right">Commission</TH></tr></thead><tbody>{partners.map((p) => <tr key={p.business_name}><TD>{p.business_name}<p className="text-xs capitalize text-navy-900/50">{p.category}</p></TD><TD className="text-right">{p.bookings}</TD><TD className="text-right tabular-nums">{aud(p.gbv)}</TD><TD className="text-right tabular-nums">{aud(p.comm)}</TD></tr>)}</tbody></Table></CardBody></Card>
      </div>
    </>
  );
}
