'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { lkr, dateTime } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { Empty, ErrorBox, Loading, Pill, SandboxBadge, StatusPill } from '@/components/ui';

function Inner() {
  const sp = useSearchParams(); const [failed, setFailed] = useState(sp.get('failed') === '1'); const [method, setMethod] = useState('');
  const { data, loading, error, reload } = useApi<any[]>(`/api/admin/transactions?limit=200${failed ? '&failed=true' : ''}${method ? `&method=${method}` : ''}`, [failed, method]);
  const { data: ev } = useApi<any[]>('/api/admin/webhook-events');
  return (<>
    <PageHead title="Transactions" sub="All restaurants" actions={<><a className="btn btn-line btn-sm" href="/api/admin/export/transactions">⬇ All CSV</a><a className="btn btn-line btn-sm" href="/api/admin/export/failed">⬇ Failed CSV</a></>} />
    <div className="mb-3 flex flex-wrap gap-2"><button className={`btn btn-sm ${failed ? 'btn-brand' : 'btn-ghost'}`} aria-pressed={failed} onClick={() => setFailed(!failed)}>⚠ Failed / needs refund</button>
      <select className="input w-44" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method"><option value="">All methods</option><option value="lankaqr">LankaQR</option><option value="card">Card</option></select></div>
    <ErrorBox error={error} retry={reload} />{loading ? <Loading /> : !data?.length ? <Empty icon="✅" title="Nothing to show" /> :
      <div className="card overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="p-3">When</th><th>Restaurant</th><th>Order</th><th>Method</th><th>Status</th><th className="text-right">Amount</th><th>Reference</th><th className="p-3">Detail</th></tr></thead>
        <tbody>{data.map((t) => <tr key={t.id} className="border-t border-line align-top"><td className="p-3 whitespace-nowrap">{dateTime(t.created_at)}</td><td>{t.restaurant}</td><td>#{t.order_number}</td><td>{t.method === 'lankaqr' ? 'LankaQR' : 'Card'} {t.mode === 'sandbox' && <SandboxBadge className="ml-1" />}</td>
          <td><StatusPill s={t.status} />{t.needs_refund && <div className="mt-1"><Pill tone="bad">needs refund</Pill></div>}</td><td className="text-right tabular">{lkr(t.amount_cents, { dec: true })}</td><td className="font-mono text-xs">{t.provider_ref ?? '—'}</td><td className="p-3 text-xs text-muted">{t.failure_message ?? t.failure_code ?? ''}</td></tr>)}</tbody></table></div>}
    <h2 className="mb-2 mt-8 font-extrabold">Recent webhook deliveries</h2>
    <div className="card overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="p-3">Received</th><th>Provider</th><th>Event</th><th>Signature</th><th className="p-3">Result</th></tr></thead>
      <tbody>{ev?.map((e) => <tr key={e.id} className="border-t border-line"><td className="p-3 whitespace-nowrap">{dateTime(e.received_at)}</td><td>{e.provider}</td><td className="font-mono text-xs">{e.event_type ?? '—'}</td><td>{e.signature_ok ? <Pill tone="ok">verified</Pill> : <Pill tone="bad">rejected</Pill>}</td><td className="p-3 text-xs text-muted">{e.result}</td></tr>)}</tbody></table></div>
  </>);
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
