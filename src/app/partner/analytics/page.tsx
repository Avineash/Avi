import type { Metadata } from "next";
import Link from "next/link";
import { BarChart, Stat, moneyLabel, pct } from "@/components/charts";
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { partnerStats } from "@/lib/domain/analytics";
import { aud } from "@/lib/util";

export const metadata: Metadata = { title: "Analytics" };

export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: d } = await searchParams;
  const days = [7, 30, 90].includes(Number(d)) ? Number(d) : 30;
  const u = await requirePermission("partner:portal", "/partner/analytics");
  const s = await partnerStats(await getDb(), u.partnerId!, days);
  return (
    <>
      <PageHeader title="Analytics" eyebrow={`Last ${days} days`}>{[7, 30, 90].map((n) => <Button key={n} asChild size="sm" variant={n === days ? "default" : "outline"}><Link href={`/partner/analytics?days=${n}`}>{n}d</Link></Button>)}</PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total bookings" value={s.bookings} /><Stat label="Revenue" value={aud(s.revenue, { whole: true })} /><Stat label="Average selling price" value={aud(s.avgPrice, { whole: true })} /><Stat label="Inventory utilisation" value={pct(s.utilisation)} hint={`${s.unitsSold}/${s.unitsTotal} units`} />
        <Stat label="Commission expense" value={aud(s.commission, { whole: true })} /><Stat label="Net earnings" value={aud(s.netEarnings, { whole: true })} tone="gold" /><Stat label="Cancellation rate" value={pct(s.cancellationRate)} /><Stat label="Refunded" value={aud(s.refundedCents, { whole: true })} hint={`${pct(s.refundRate)} of bookings`} />
        <Stat label="Waitlist demand" value={s.waitlistDemand} hint={`${s.waitlistListings} listings`} /><Stat label="Buyback proposals" value={s.buybackTotal} /><Stat label="Buyback acceptance" value={pct(s.buybackAcceptRate)} /><Stat label="Buyback benefit realised" value={aud(s.buybackBenefit, { whole: true })} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Revenue</CardTitle></CardHeader><CardBody><BarChart title="Revenue by day" data={s.series.map((x) => ({ label: x.day, value: x.revenue }))} valueLabel={moneyLabel} /></CardBody></Card>
        <Card><CardHeader><CardTitle>Bookings</CardTitle></CardHeader><CardBody><BarChart title="Bookings by day" data={s.series.map((x) => ({ label: x.day, value: x.bookings }))} /></CardBody></Card>
      </div>
    </>
  );
}
