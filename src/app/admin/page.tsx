import type { Metadata } from "next";
import Link from "next/link";
import { BarChart, Stat, moneyLabel, pct } from "@/components/charts";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { adminStats, operationalAlerts } from "@/lib/domain/analytics";
import { aud } from "@/lib/util";

export const metadata: Metadata = { title: "Platform overview" };

export default async function Overview() {
  await requirePermission("admin:portal", "/admin");
  const db = await getDb();
  const s = await adminStats(db, 30);
  const alerts = await operationalAlerts(db);
  return (
    <>
      <PageHeader title="Platform overview" eyebrow="Last 30 days" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross booking value" value={aud(s.gbv, { whole: true })} hint="incl. service fees" /><Stat label="Platform revenue" value={aud(s.platformRevenue, { whole: true })} hint="fees + commissions, net of reversals" tone="gold" />
        <Stat label="Active partners" value={s.activePartners} hint={`${s.pendingPartners} pending · ${s.suspendedPartners} suspended`} /><Stat label="Successful bookings" value={s.bookings} />
        <Stat label="Refund exposure" value={aud(s.refundExposure, { whole: true })} hint={`${aud(s.exposureBreakdown.pendingRefunds)} pending · ${aud(s.exposureBreakdown.openDisputes)} disputed`} tone={s.refundExposure > 0 ? "danger" : undefined} />
        <Stat label="Inventory fill rate" value={pct(s.fillRate)} hint={`${s.unitsAvailable} of ${s.unitsTotal} units open`} /><Stat label="Waitlist demand" value={s.waitlistDemand} hint="active entries" /><Stat label="Ledger reconciliation" value={s.reconciliation.balanced ? "Balanced" : "OFF"} hint={`held ${aud(s.reconciliation.cashHeld, { whole: true })}`} tone={s.reconciliation.balanced ? undefined : "danger"} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card><CardHeader><CardTitle>Gross booking value by day</CardTitle></CardHeader><CardBody><BarChart title="GBV by day" data={s.series.map((d) => ({ label: d.day, value: d.gbv }))} valueLabel={moneyLabel} /></CardBody></Card>
        <Card><CardHeader><CardTitle>Operational alerts</CardTitle></CardHeader><CardBody>
          {alerts.length === 0 ? <p className="text-sm text-success">All clear.</p> : <ul className="space-y-2 text-sm">{alerts.map((a, i) => <li key={i} className="flex items-start gap-2"><Badge tone={a.level === "error" ? "danger" : a.level === "warn" ? "warn" : "neutral"}>{a.level}</Badge>{a.href ? <Link href={a.href} className="underline">{a.message}</Link> : a.message}</li>)}</ul>}
        </CardBody></Card>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card><CardHeader><CardTitle>By category</CardTitle></CardHeader><CardBody><ul className="divide-y divide-navy-900/10 text-sm">{s.byCategory.map((c) => <li key={c.category} className="flex justify-between py-2 capitalize"><span>{c.category}</span><span>{c.bookings} bookings · {aud(c.gbv, { whole: true })}</span></li>)}</ul></CardBody></Card>
        <Card><CardHeader><CardTitle>Buyback programme</CardTitle></CardHeader><CardBody className="text-sm"><p>{s.buyback.total} proposals · {s.buyback.accepted} accepted · {s.buyback.awaiting} awaiting approval.</p><Link href="/admin/buybacks" className="mt-2 inline-block font-semibold underline">Monitor buybacks</Link></CardBody></Card>
      </div>
    </>
  );
}
