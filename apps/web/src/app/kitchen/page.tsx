'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useGuard, logout } from '@/components/shell';
import { tr } from '@/lib/i18n';
import { useEventStream } from '@/lib/hooks';
import { chime, unlockAudio } from '@/lib/sound';
import { lkr, time } from '@/lib/money';
import { Spinner, cx, SandboxBadge, useToast } from '@/components/ui';

interface Order { id: string; number: number; status: 'received' | 'preparing' | 'ready'; table: string; paidAt: string; method: string | null; mode: string; notes: string | null; customerName: string | null; totalCents: number;
  items: { name: any; qty: number; options: { name: any }[]; note?: string }[] }
const NEXT = { received: { to: 'preparing', label: 'Start preparing' }, preparing: { to: 'ready', label: 'Mark ready' }, ready: { to: 'served', label: 'Mark served' } } as const;
const COLS = [{ id: 'received', title: 'New', tone: 'text-sky-300' }, { id: 'preparing', title: 'Preparing', tone: 'text-amber-300' }, { id: 'ready', title: 'Ready to serve', tone: 'text-emerald-300' }] as const;

export default function Kitchen() {
  const me = useGuard('restaurant');
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(false);
  const [, tick] = useState(0);
  const known = useRef<Set<string>>(new Set()); const first = useRef(true); const soundRef = useRef(false); soundRef.current = sound;

  const load = useCallback(async () => {
    try {
      const list = await api<Order[]>('/api/r/orders?view=active');
      const newOnes = list.filter((o) => !known.current.has(o.id));
      if (!first.current && newOnes.length) { setFresh((f) => new Set([...f, ...newOnes.map((o) => o.id)])); if (soundRef.current) chime(2); setTimeout(() => setFresh((f) => { const n = new Set(f); newOnes.forEach((o) => n.delete(o.id)); return n; }), 6000); }
      list.forEach((o) => known.current.add(o.id)); first.current = false; setOrders(list);
    } catch (e) { if ((e as ApiError).status === 401) location.href = '/login'; }
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(i); }, []);
  const live = useEventStream(me ? '/api/r/stream' : null, (t) => { if (t !== 'hello') load(); }, load, 10000);

  async function advance(o: Order) {
    const to = NEXT[o.status].to;
    setOrders((cur) => cur && (to === 'served' ? cur.filter((x) => x.id !== o.id) : cur.map((x) => (x.id === o.id ? { ...x, status: to as Order['status'] } : x))));
    try { await api(`/api/r/orders/${o.id}/status`, { body: { status: to } }); } catch (e) { toast((e as ApiError).message, 'bad'); load(); }
  }
  if (!me || !orders) return <div className="grid min-h-dvh place-items-center bg-[#0b0c0f] text-white/60"><Spinner /></div>;

  return (
    <div data-theme="dark" className="min-h-dvh bg-[#0b0c0f] text-white">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0b0c0f]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500 font-black text-emerald-950">K</span>
          <div><h1 className="font-extrabold leading-none">Kitchen · {me.restaurantName}</h1><div className="mt-1 flex items-center gap-2 text-xs text-white/50"><span className={cx('h-2 w-2 rounded-full', live ? 'bg-emerald-400' : 'bg-amber-400')} />{live ? 'Live' : 'Reconnecting — polling'} · {orders.length} active</div></div></div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const s = unlockAudio(); const on = !sound; setSound(on && s !== 'unsupported'); if (on) chime(1); }} aria-pressed={sound}
            className={cx('rounded-xl px-4 py-2.5 text-sm font-bold', sound ? 'bg-emerald-500 text-emerald-950' : 'bg-amber-400 text-amber-950 animate-flash')}>{sound ? '🔔 Sound on' : '🔕 Tap to enable sound'}</button>
          {me.perms.includes('reports:read') && <Link href="/dashboard" className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold">Dashboard</Link>}
          <button onClick={logout} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold">Sign out</button></div>
      </header>
      {orders.length === 0 && <div className="grid place-items-center px-6 py-32 text-center text-white/50"><div><div className="text-6xl">🍽️</div><p className="mt-4 text-lg font-bold text-white/80">No active orders</p><p className="text-sm">Paid orders appear here instantly.</p></div></div>}
      <div className="grid gap-4 p-4 md:grid-cols-3">
        {COLS.map((col) => { const list = orders.filter((o) => o.status === col.id); return (
          <section key={col.id} aria-label={col.title}>
            <h2 className={cx('mb-3 flex items-center justify-between px-1 text-sm font-extrabold uppercase tracking-widest', col.tone)}><span>{col.title}</span><span className="rounded-full bg-white/10 px-2.5 py-0.5 text-white">{list.length}</span></h2>
            <div className="space-y-3">{list.map((o) => {
              const mins = Math.floor((Date.now() - new Date(o.paidAt).getTime()) / 60000);
              const late = col.id !== 'ready' && mins >= 20, warn = col.id !== 'ready' && mins >= 10;
              return (
                <article key={o.id} className={cx('overflow-hidden rounded-2xl bg-[#16181d] ring-1 ring-white/10', fresh.has(o.id) && 'animate-flash ring-2 ring-emerald-400', late && 'ring-2 ring-red-500')}>
                  <div className="flex items-center justify-between gap-3 bg-white/5 px-4 py-3">
                    <div className="flex items-baseline gap-3"><span className="text-3xl font-black tabular">#{o.number}</span><span className="rounded-lg bg-white px-2.5 py-1 text-lg font-black text-black">T{o.table.replace(/^T/i, '')}</span></div>
                    <div className="text-right"><div className={cx('text-xl font-black tabular', late ? 'text-red-400' : warn ? 'text-amber-300' : 'text-white')}>{mins < 1 ? 'now' : `${mins}m`}</div><div className="text-[11px] text-white/50">paid {time(o.paidAt)}</div></div></div>
                  <ul className="space-y-2 px-4 py-3">{o.items.map((i, k) => (
                    <li key={k} className="flex gap-3"><span className="min-w-8 text-xl font-black tabular text-emerald-300">{i.qty}×</span>
                      <div className="min-w-0"><div className="text-lg font-bold leading-tight">{tr(i.name, 'en')}</div>
                        {i.options.length > 0 && <div className="text-sm text-white/60">{i.options.map((x) => tr(x.name, 'en')).join(' · ')}</div>}
                        {i.note && <div className="mt-1 inline-block rounded-md bg-amber-400 px-2 py-0.5 text-sm font-bold text-amber-950">⚠ {i.note}</div>}</div></li>))}</ul>
                  <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-2 text-xs text-white/60"><span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">✓ PAID · {o.method === 'lankaqr' ? 'LankaQR' : 'Card'}</span>{o.mode === 'sandbox' && <SandboxBadge />}{o.customerName && <span>{o.customerName}</span>}<span className="ml-auto tabular">{lkr(o.totalCents)}</span></div>
                  <button onClick={() => advance(o)} className={cx('block min-h-[56px] w-full text-lg font-extrabold transition active:brightness-90', col.id === 'received' ? 'bg-sky-500 text-sky-950' : col.id === 'preparing' ? 'bg-amber-400 text-amber-950' : 'bg-emerald-500 text-emerald-950')}>{NEXT[o.status].label} →</button>
                </article>); })}
            </div>
          </section>); })}
      </div>
    </div>
  );
}
