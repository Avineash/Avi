'use client';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { lkr } from '@/lib/money';
import { PageHead, useMe, can } from '@/components/shell';
import { BarChart, ShareBar, Stat } from '@/components/charts';
import { ErrorBox, Loading, Toggle, useToast } from '@/components/ui';
import Link from 'next/link';

export default function AdminHome() {
  const me = useMe(); const toast = useToast();
  const { data, loading, error, reload } = useApi<any>('/api/admin/overview'); const { data: outage, reload: rOut } = useApi<Record<string, boolean>>('/api/admin/sandbox/outage');
  if (loading) return <Loading />; if (error) return <ErrorBox error={error} retry={reload} />; if (!data) return null;
  const q = data.byMethod.find((m: any) => m.method === 'lankaqr'), c = data.byMethod.find((m: any) => m.method === 'card');
  const bars = data.daily.map((d: any) => ({ label: d.day.slice(8), sub: d.day, values: { gmv: d.gmv } }));
  const flip = async (provider: string, on: boolean) => { try { await api('/api/admin/sandbox/outage', { body: { provider, on } }); rOut(); toast(`${provider} outage ${on ? 'ON — customers see the fallback' : 'cleared'}`); } catch (e) { toast((e as ApiError).message, 'bad'); } };
  return (<>
    <PageHead title="Platform overview" sub="Last 30 days unless stated" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Active restaurants" value={String(data.restaurants.active ?? 0)} sub={`${data.restaurants.suspended ?? 0} suspended`} /><Stat label="Pending approval" value={String(data.restaurants.pending ?? 0)} href="/admin/restaurants" tone={data.restaurants.pending ? 'warn' : undefined} />
      <Stat label="Volume (30d)" value={lkr(data.volume.month.gmv)} sub={`${data.volume.month.txns} payments`} /><Stat label="Today" value={lkr(data.volume.day.gmv)} sub={`${data.volume.day.txns} payments`} />
      <Stat label="Platform revenue (30d)" value={lkr(data.revenue.total30dCents)} sub={`${lkr(data.revenue.subscriptionsMonthlyCents)} subscriptions + ${lkr(data.revenue.transactionFees30dCents, { dec: true })} fees`} />
      <Stat label="Payment failure rate (7d)" value={`${(data.failureRate7d * 100).toFixed(1)}%`} sub={`${data.failed7d} failed/expired`} href="/admin/transactions?failed=1" /><Stat label="Needs refund" value={String(data.open.needs_refund)} tone={data.open.needs_refund ? 'bad' : undefined} href="/admin/transactions?failed=1" /><Stat label="Open tickets" value={String(data.open.tickets)} href="/admin/support" />
    </div>
    <section className="card mt-5 p-4 sm:p-5"><h2 className="mb-3 font-extrabold">Payment volume, 14 days</h2><BarChart bars={bars} series={[{ key: 'gmv', name: 'Volume', color: 'var(--series-1)' }]} format={(n) => lkr(n)} yLabel="Day" /></section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="card p-4 sm:p-5"><h2 className="mb-3 font-extrabold">LankaQR vs card (30d)</h2><ShareBar format={(n) => lkr(n)} parts={[{ name: 'LankaQR', color: 'var(--series-1)', value: q?.gmv ?? 0, count: q?.txns ?? 0 }, { name: 'Credit/Debit card', color: 'var(--series-2)', value: c?.gmv ?? 0, count: c?.txns ?? 0 }]} /></section>
      {data.sandbox && can(me, 'platform:write') && <section className="card p-4 sm:p-5"><h2 className="mb-1 font-extrabold">🧪 Sandbox controls</h2><p className="mb-3 text-sm text-muted">Simulate a provider outage to see customers automatically offered the fallback.</p>
        {(['sandbox_lankaqr', 'sandbox_card'] as const).map((p) => <div key={p} className="flex items-center justify-between border-t border-line py-3"><span className="text-sm font-semibold">{p === 'sandbox_lankaqr' ? 'LankaQR provider outage' : 'Card gateway outage'}</span><Toggle on={!!outage?.[p]} onChange={(v) => flip(p, v)} label={p} /></div>)}
        <button className="btn btn-line btn-sm mt-2" onClick={async () => { const r = await api<any>('/api/admin/sandbox/settle', { method: 'POST', body: {} }); toast(`Sandbox settlement ${r.settlementRef}: ${r.settled} transactions`); }}>Run sandbox settlement</button></section>}
    </div>
    <p className="mt-6 text-sm text-muted">Exports: <a className="font-bold text-brandtext" href="/api/admin/export/revenue">Revenue CSV</a> · <a className="font-bold text-brandtext" href="/api/admin/export/transactions">Transactions CSV</a> · <a className="font-bold text-brandtext" href="/api/admin/export/restaurants">Restaurants CSV</a> · <Link className="font-bold text-brandtext" href="/admin/transactions?failed=1">Failed payments</Link></p>
  </>);
}
