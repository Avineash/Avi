'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi, useEventStream } from '@/lib/hooks';
import { lkr, time, dateTime } from '@/lib/money';
import { tr } from '@/lib/i18n';
import { PageHead, useMe, can } from '@/components/shell';
import { Empty, Loading, StatusPill, SandboxBadge, useToast, cx } from '@/components/ui';
import { chime, unlockAudio } from '@/lib/sound';

const NEXT: Record<string, { to: string; label: string } | undefined> = { received: { to: 'preparing', label: 'Start preparing' }, preparing: { to: 'ready', label: 'Mark ready' }, ready: { to: 'served', label: 'Mark served' } };

export default function Orders() {
  const me = useMe(); const toast = useToast();
  const [view, setView] = useState<'active' | 'pending' | 'history'>('active');
  const { data, loading, reload } = useApi<any[]>(`/api/r/orders?view=${view}`, [view]);
  const [sound, setSound] = useState(false); const seen = useRef<Set<string> | null>(null);
  const live = useEventStream('/api/r/stream', (t, d) => { if (t === 'order.paid' && sound) chime(1); if (t !== 'hello') reload(); }, reload, 10000);
  useEffect(() => { if (data && view === 'active') seen.current = new Set(data.map((o) => o.id)); }, [data, view]);
  const move = useCallback(async (id: string, to: string) => { try { await api(`/api/r/orders/${id}/status`, { body: { status: to } }); reload(); } catch (e) { toast((e as ApiError).message, 'bad'); } }, [reload, toast]);
  const canAct = can(me, 'orders:update');
  return (
    <>
      <PageHead title="Orders" sub={live ? 'Live — updates appear instantly' : 'Reconnecting…'} actions={<>
        <button className="btn btn-ghost btn-sm" aria-pressed={sound} onClick={() => { unlockAudio(); setSound(!sound); if (!sound) chime(1); }}>{sound ? '🔔 Sound on' : '🔕 Sound off'}</button>
        <div className="inline-flex rounded-full bg-sunken p-1">{([['active', 'Active'], ['pending', 'Awaiting payment'], ['history', 'History']] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${view === v ? 'bg-surface shadow-card' : 'text-muted'}`}>{l}</button>)}</div></>} />
      {loading ? <Loading /> : !data?.length ? <Empty icon="🧾" title="Nothing here">{view === 'active' ? 'Paid orders appear here the moment the bank or card gateway confirms them.' : view === 'pending' ? 'Customers who have ordered but not yet paid. These are NOT sent to the kitchen.' : 'Completed orders will show up here.'}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((o) => (
            <article key={o.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2"><div><div className="flex items-baseline gap-2"><span className="font-display text-2xl font-extrabold tabular">#{o.number}</span><span className="rounded-lg bg-sunken px-2 py-0.5 text-sm font-bold">Table {o.table}</span></div>
                <div className="mt-0.5 text-xs text-muted">{view === 'history' ? dateTime(o.createdAt) : time(o.paidAt ?? o.createdAt)}{o.customerName ? ` · ${o.customerName}` : ''}</div></div>
                <div className="flex flex-col items-end gap-1"><StatusPill s={o.status} />{o.mode === 'sandbox' && <SandboxBadge />}</div></div>
              <ul className="my-3 flex-1 space-y-1 text-sm">{o.items.map((i: any, k: number) => <li key={k}><b className="tabular">{i.qty}×</b> {tr(i.name, 'en')}{i.options?.length > 0 && <span className="text-muted"> · {i.options.map((x: any) => tr(x.name, 'en')).join(', ')}</span>}{i.note && <span className="block text-xs font-semibold text-warn">⚠ {i.note}</span>}</li>)}</ul>
              <div className="flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-muted">{o.method ? (o.method === 'lankaqr' ? 'LankaQR' : 'Card') : 'Unpaid'}{o.paymentStatus !== 'paid' && o.paymentStatus !== 'unpaid' && <> · <StatusPill s={o.paymentStatus} /></>}</span><b className="tabular">{lkr(o.totalCents)}</b></div>
              {canAct && NEXT[o.status] && o.paymentStatus !== 'unpaid' && <button className={cx('btn mt-3', 'btn-brand')} onClick={() => move(o.id, NEXT[o.status]!.to)}>{NEXT[o.status]!.label} →</button>}
            </article>))}
        </div>)}
    </>
  );
}
