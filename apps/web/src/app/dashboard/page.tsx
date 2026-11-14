'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { lkr, lkrCompact } from '@/lib/money';
import { PageHead, useMe, can } from '@/components/shell';
import { BarChart, ShareBar, Stat } from '@/components/charts';
import { Loading, ErrorBox, Empty } from '@/components/ui';

const colombo = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 - offsetDays * 864e5).toISOString().slice(0, 10);

export default function Overview() {
  const me = useMe();
  const [days, setDays] = useState(14);
  const from = colombo(days - 1), to = colombo(0);
  const { data, error, loading, reload } = useApi<any>(can(me, 'reports:read') ? `/api/r/reports/sales?from=${from}&to=${to}` : null, [days]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Empty title="Welcome">Use the menu to manage orders.</Empty>;
  const t = data.totals;
  const byDay = new Map<string, any>(data.daily.map((d: any) => [d.day, d]));
  const bars = Array.from({ length: days }, (_, i) => { const d = colombo(days - 1 - i); const r = byDay.get(d); return { label: d.slice(8), sub: new Date(d).toLocaleDateString('en-LK', { weekday: 'short', day: 'numeric', month: 'short' }), values: { gross: (r?.gross ?? 0) } }; });
  const q = data.byMethod.find((m: any) => m.method === 'lankaqr'), c = data.byMethod.find((m: any) => m.method === 'card');
  const split = [{ name: 'LankaQR', color: 'var(--series-1)', value: q?.gross ?? 0, count: q?.payments ?? 0 }, { name: 'Credit/Debit card', color: 'var(--series-2)', value: c?.gross ?? 0, count: c?.payments ?? 0 }];
  const fees = (q?.fees ?? 0) + (c?.fees ?? 0);
  return (
    <>
      <PageHead title="Sales overview" sub={`${from} → ${to} · Asia/Colombo`} actions={<div className="inline-flex rounded-full bg-sunken p-1">{[7, 14, 30].map((n) => <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${days === n ? 'bg-surface shadow-card' : 'text-muted'}`}>{n}d</button>)}</div>} />
      {(t.paymentsNeedingRefund > 0 || t.failedPayments > 5) && <div className="mb-4 space-y-2">
        {t.paymentsNeedingRefund > 0 && <Link href="/dashboard/payments?tab=payments&needs=1" className="card flex items-center justify-between border-bad/40 bg-bad/5 p-4 text-sm font-semibold text-bad"><span>⚠ {t.paymentsNeedingRefund} payment(s) need a refund (duplicate or mismatched capture)</span><span>Review →</span></Link>}
      </div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross sales" value={lkr(t.gross, { dec: false })} sub={`${t.orders} paid orders`} /><Stat label="Net of refunds" value={lkr(t.net, { dec: false })} sub={t.refunds ? `${lkr(t.refunds)} refunded` : 'No refunds'} />
        <Stat label="Avg order" value={lkr(t.avg, { dec: false })} sub={`${t.avg_prep_min || '—'} min avg to ready`} /><Stat label="Customer rating" value={t.ratings ? `${t.avgRating} ★` : '—'} sub={`${t.ratings} reviews`} />
      </div>
      <section className="card mt-5 p-4 sm:p-5"><h2 className="mb-3 font-extrabold">Daily sales</h2><BarChart bars={bars} series={[{ key: 'gross', name: 'Gross sales', color: 'var(--series-1)' }]} format={(n) => lkr(n)} axis={lkrCompact} yLabel="Day" /></section>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-4 sm:p-5"><h2 className="mb-3 font-extrabold">LankaQR vs card</h2><ShareBar parts={split} format={(n) => lkr(n)} />
          <p className="mt-3 text-xs text-muted">Estimated provider fees in period: <b className="tabular">{lkr(fees, { dec: true })}</b> (sandbox rates are illustrative).</p></section>
        <section className="card p-4 sm:p-5"><h2 className="mb-3 font-extrabold">Top items</h2>
          {data.topItems.length === 0 ? <p className="text-sm text-muted">No sales yet.</p> : <ol className="space-y-2.5">{data.topItems.map((i: any, k: number) => { const max = data.topItems[0].qty; return (
            <li key={k} className="text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{i.name}</span><span className="tabular text-muted">{i.qty} sold · {lkr(i.revenue)}</span></div><div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${(i.qty / max) * 100}%`, background: 'var(--series-1)' }} /></div></li>); })}</ol>}</section>
      </div>
    </>
  );
}
