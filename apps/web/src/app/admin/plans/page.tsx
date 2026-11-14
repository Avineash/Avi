'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { lkr } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { ErrorBox, Field, Loading, Pill, Sheet, useToast } from '@/components/ui';

export default function Plans() {
  const toast = useToast(); const { data, loading, error, reload } = useApi<any[]>('/api/admin/plans'); const [e, setE] = useState<any>(null);
  return (<>
    <PageHead title="Subscription plans" sub="Illustrative defaults — set your real pricing here." actions={<button className="btn btn-brand btn-sm" onClick={() => setE({ id: '', name: '', fee: 0, bps: 50, max: 20, active: true, isNew: true })}>+ Plan</button>} />
    <ErrorBox error={error} retry={reload} />{loading ? <Loading /> : <div className="grid gap-3 sm:grid-cols-3">{data?.map((p) => <div key={p.id} className="card p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">{p.name}</h2>{!p.active && <Pill>inactive</Pill>}</div>
      <div className="mt-2 font-display text-3xl font-extrabold tabular">{lkr(p.monthly_fee_cents)}<span className="text-sm font-medium text-muted"> /mo</span></div><ul className="mt-3 space-y-1 text-sm text-muted"><li>+ {p.txn_fee_bps / 100}% per paid order (invoiced separately)</li><li>Up to {p.max_tables} tables</li><li>{p.restaurants} restaurant(s)</li></ul>
      <button className="btn btn-line btn-sm mt-4" onClick={() => setE({ id: p.id, name: p.name, fee: p.monthly_fee_cents / 100, bps: p.txn_fee_bps, max: p.max_tables, active: p.active })}>Edit</button></div>)}</div>}
    <Sheet open={!!e} onClose={() => setE(null)} title={e?.isNew ? 'New plan' : 'Edit plan'}>{e && <form className="space-y-3 p-5" onSubmit={async (ev) => { ev.preventDefault(); try { await api(`/api/admin/plans/${e.id || e.name}`, { method: 'PUT', body: { name: e.name, monthlyFeeCents: Math.round(e.fee * 100), txnFeeBps: e.bps, maxTables: e.max, active: e.active } }); setE(null); reload(); } catch (x) { toast((x as ApiError).message, 'bad'); } }}>
      <Field label="Name"><input className="input" required value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field><div className="grid grid-cols-3 gap-3"><Field label="Monthly Rs."><input className="input" type="number" min={0} value={e.fee} onChange={(x) => setE({ ...e, fee: +x.target.value })} /></Field><Field label="Txn fee bps"><input className="input" type="number" min={0} max={1000} value={e.bps} onChange={(x) => setE({ ...e, bps: +x.target.value })} /></Field><Field label="Max tables"><input className="input" type="number" min={1} value={e.max} onChange={(x) => setE({ ...e, max: +x.target.value })} /></Field></div>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} className="h-5 w-5 accent-[rgb(var(--brand))]" /> Active (available to new restaurants)</label><button className="btn btn-brand w-full">Save</button></form>}</Sheet>
  </>);
}
