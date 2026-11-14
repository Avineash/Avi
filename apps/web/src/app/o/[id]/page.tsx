'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, newKey } from '@/lib/api';
import { useI18n, tr, type L10n } from '@/lib/i18n';
import { lkr, lkrFull, time } from '@/lib/money';
import { useCountdown, useEventStream } from '@/lib/hooks';
import { BrandShell, PaymentSelector, QrIcon, type Branding, type MethodInfo } from '@/components/customer';
import { Spinner, cx, SandboxBadge } from '@/components/ui';

interface OrderView {
  id: string; number: number; status: string; paymentStatus: string; sandbox: boolean; table: string; createdAt: string; etaMinutes: number;
  totals: { subtotal: number; service: number; tax: number; total: number }; rates: { serviceBps: number; taxBps: number; taxLabel: string };
  items: { name: L10n; qty: number; lineTotalCents: number; options: { name: L10n }[]; note?: string }[];
  restaurant: { name: string; slug: string; branding: Branding }; payment: { id: string; method: string; status: string } | null; feedbackGiven: number | null;
}
interface PayView { id: string; method: 'lankaqr' | 'card'; status: string; amountCents: number; expiresAt: string; sandbox: boolean; qrSvg?: string; deepLink?: string; redirect?: { url: string; method: 'GET' | 'POST'; fields?: Record<string, string> }; failureMessage?: string; failureCode?: string }

const STEPS = ['received', 'preparing', 'ready', 'served'] as const;

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tk = useSearchParams().get('t') ?? '';
  const { t, lang } = useI18n();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [pay, setPay] = useState<PayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const paid = order && order.paymentStatus !== 'unpaid';

  const loadOrder = useCallback(async () => {
    try { const o = await api<OrderView>(`/api/public/orders/${id}?t=${tk}`); setOrder(o); setError(null); return o; }
    catch (e) { setError((e as ApiError).message); return null; }
  }, [id, tk]);
  const loadPay = useCallback(async (pid?: string) => {
    const p = pid ?? order?.payment?.id; if (!p) return;
    try { const v = await api<PayView>(`/api/public/payments/${p}?t=${tk}`); setPay(v); if (v.status === 'paid') loadOrder(); } catch { /* transient */ }
  }, [order?.payment?.id, tk, loadOrder]);

  useEffect(() => { loadOrder(); }, [loadOrder]);
  useEffect(() => { if (order && !paid && order.payment) loadPay(order.payment.id); }, [order?.payment?.id, paid]); // eslint-disable-line react-hooks/exhaustive-deps
  // real-time push + polling safety net. We only ever trust the SERVER's view of payment state.
  useEventStream(tk ? `/api/public/orders/${id}/stream?t=${tk}` : null, (type) => { if (type !== 'hello') { loadOrder(); if (!paid) loadPay(); } }, () => { loadOrder(); if (!paid) loadPay(); }, 3000);

  if (error && !order) return <div className="grid min-h-dvh place-items-center p-8 text-center"><div><div className="mb-3 text-5xl">🔍</div><p className="font-semibold">{error}</p></div></div>;
  if (!order) return <div className="grid min-h-dvh place-items-center text-muted"><Spinner /></div>;

  return (
    <BrandShell branding={order.restaurant.branding} sandbox={order.sandbox}>
      <div className="px-5 pb-16 pt-16">
        <div className="mb-1 flex items-center gap-2 text-sm font-bold text-muted">{order.restaurant.name} · {t('table')} {order.table}</div>
        <h1 className="font-display text-3xl font-extrabold">{t('orderNumber')} #{order.number}</h1>
        {paid ? <Tracking order={order} reload={loadOrder} tk={tk} />
          : <PaymentPanel order={order} pay={pay} setPay={setPay} reload={() => { loadOrder(); loadPay(); }} tk={tk} changing={changing} setChanging={setChanging} />}
        <Summary order={order} />
      </div>
    </BrandShell>
  );
}

/* ───────────────────────── payment ───────────────────────── */
function PaymentPanel({ order, pay, setPay, reload, tk, changing, setChanging }: { order: OrderView; pay: PayView | null; setPay: (p: PayView | null) => void; reload: () => void; tk: string; changing: boolean; setChanging: (v: boolean) => void }) {
  const { t } = useI18n();
  const [methods, setMethods] = useState<MethodInfo[] | null>(null);
  const [pick, setPick] = useState<'lankaqr' | 'card' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const status = pay?.status ?? 'none';
  const dead = ['failed', 'expired', 'cancelled'].includes(status);
  const chooser = changing || !pay || dead;

  const loadMethods = useCallback(() => api<{ methods: MethodInfo[] }>(`/api/public/orders/${order.id}/methods?t=${tk}`).then((r) => { setMethods(r.methods); setPick((c) => c && r.methods.some((m) => m.method === c && m.available) ? c : r.methods.find((m) => m.method === 'lankaqr' && m.available) ? 'lankaqr' : r.methods.find((m) => m.available)?.method ?? null); }).catch(() => setMethods([])), [order.id, tk]);
  useEffect(() => { if (chooser) loadMethods(); }, [chooser, loadMethods]);

  async function start(method: 'lankaqr' | 'card') {
    setBusy(true); setMsg(null);
    try { const p = await api<PayView>(`/api/public/orders/${order.id}/payments?t=${tk}`, { body: { method }, headers: { 'idempotency-key': `${newKey()}` } }); setPay(p); setChanging(false); reload(); }
    catch (e) { const ex = e as ApiError; setMsg(ex.data?.fallback === 'card' ? t('lankaqrUnavailable') : ex.message); loadMethods(); if (ex.data?.fallback) setPick(ex.data.fallback); }
    finally { setBusy(false); }
  }

  if (pay && !chooser && pay.method === 'lankaqr') return <QrPanel pay={pay} onChange={() => setChanging(true)} />;
  if (pay && !chooser && pay.method === 'card') return <CardPanel pay={pay} onChange={() => setChanging(true)} />;

  return (
    <section className="mt-6" aria-live="polite">
      {pay && status === 'failed' && <div role="alert" className="mb-4 rounded-2xl border border-bad/40 bg-bad/10 p-4"><div className="font-bold text-bad">{t('payFailed')}</div><div className="mt-1 text-sm text-ink/80">{pay.failureMessage ? `${pay.failureMessage}. ` : ''}{t('payFailedHelp')}</div></div>}
      {pay && status === 'expired' && <div role="alert" className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 p-4 font-bold text-warn">{t('qrExpired')}</div>}
      {pay && status === 'cancelled' && <div className="mb-4 rounded-2xl border border-line bg-sunken p-4 font-semibold">{t('paymentCancelled')}</div>}
      <h2 className="mb-3 text-lg font-extrabold">{t('chooseHowToPay')}</h2>
      <PaymentSelector methods={methods} value={pick} onChange={setPick} />
      {msg && <div role="alert" className="mt-3 rounded-2xl border border-warn/40 bg-warn/10 p-3.5 text-sm font-medium text-warn">{msg}</div>}
      <button className="btn btn-brand mt-5 w-full py-4 text-base" disabled={!pick || busy} onClick={() => pick && start(pick)}>{busy ? <Spinner /> : <>{t('payNow')} {lkr(order.totals.total)}</>}</button>
    </section>
  );
}

function QrPanel({ pay, onChange }: { pay: PayView; onChange: () => void }) {
  const { t } = useI18n();
  const left = useCountdown(pay.expiresAt);
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
  const src = pay.qrSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pay.qrSvg)}` : '';
  return (
    <section className="mt-6 animate-pop" aria-live="polite">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between bg-brand px-5 py-3 text-onbrand"><span className="flex items-center gap-2 font-bold"><QrIcon /> LankaQR</span>{pay.sandbox && <SandboxBadge />}</div>
        <div className="p-5 text-center">
          <div className="text-sm font-semibold text-muted">{t('amountToPay')}</div>
          <div className="font-display text-4xl font-extrabold tabular">{lkrFull(pay.amountCents)}</div>
          <div className="relative mx-auto mt-4 w-full max-w-[280px] rounded-3xl bg-white p-3 shadow-card ring-1 ring-line">
            {src && <img src={src} alt="LankaQR payment code for this order" className={cx('aspect-square w-full', left === 0 && 'opacity-20 blur-sm')} />}
            {left === 0 && <div className="absolute inset-0 grid place-items-center font-bold text-neutral-900">{t('qrExpired')}</div>}
          </div>
          <div className="mt-3 text-sm text-muted">{t('expiresIn')} <b className="tabular text-ink">{mm}:{ss}</b></div>
          <div className="mt-4 inline-flex items-center gap-2.5 rounded-full bg-sunken px-4 py-2 text-sm font-semibold"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-brand opacity-70" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" /></span>{t('waiting')}</div>
          <p className="mt-2 text-xs text-muted">{t('confirmedByBank')}</p>
        </div>
        <ol className="space-y-2 border-t border-line bg-sunken/50 px-5 py-4 text-sm">
          {[t('howTo1'), t('howTo2'), t('howTo3')].map((s, i) => <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-onbrand">{i + 1}</span><span>{s}</span></li>)}
        </ol>
        {pay.deepLink && <div className="border-t border-line p-4"><div className="mb-2 text-center text-sm font-semibold text-muted">{t('sameDevice')}</div>
          <a href={pay.deepLink} className="btn btn-brand w-full">{t('openBankApp')} ↗</a></div>}
      </div>
      <button className="btn btn-line mt-4 w-full" onClick={onChange}>{t('tryAnother')}</button>
    </section>
  );
}

function CardPanel({ pay, onChange }: { pay: PayView; onChange: () => void }) {
  const { t } = useI18n();
  const form = useRef<HTMLFormElement>(null);
  const flag = `tf-redir-${pay.id}`;
  const [auto, setAuto] = useState(false);
  const go = useCallback(() => {
    try { sessionStorage.setItem(flag, '1'); } catch { /* ignore */ }
    if (!pay.redirect) return;
    if (pay.redirect.method === 'POST') form.current?.submit(); else window.location.assign(pay.redirect.url);
  }, [pay.redirect, flag]);
  useEffect(() => {   // redirect once; if the customer comes back (cancel/back button) they get a button instead of a loop
    let seen = false; try { seen = !!sessionStorage.getItem(flag); } catch { /* ignore */ }
    if (pay.status === 'requires_action' && pay.redirect && !seen) { setAuto(true); const id = setTimeout(go, 700); return () => clearTimeout(id); }
  }, [pay.status, pay.redirect, flag, go]);
  return (
    <section className="mt-6 animate-pop">
      <div className="card p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-3xl">💳</div>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold text-muted">{auto ? t('redirecting') : t('waiting')}{pay.sandbox && <SandboxBadge />}</div>
        <div className="mt-1 font-display text-3xl font-extrabold tabular">{lkrFull(pay.amountCents)}</div>
        {auto && <div className="mt-4 flex justify-center"><Spinner className="text-brandtext" /></div>}
        <button className="btn btn-brand mt-5 w-full" onClick={go}>{t('continueCard')}</button>
        <p className="mt-3 text-xs text-muted">🔒 Visa · Mastercard · 3-D Secure. Card details are entered on the bank&apos;s secure page, never on TableFlow.</p>
      </div>
      {pay.redirect?.method === 'POST' && <form ref={form} method="POST" action={pay.redirect.url} className="hidden">{Object.entries(pay.redirect.fields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</form>}
      <button className="btn btn-line mt-4 w-full" onClick={onChange}>{t('tryAnother')}</button>
    </section>
  );
}

/* ───────────────────────── tracking ───────────────────────── */
function Tracking({ order, reload, tk }: { order: OrderView; reload: () => void; tk: string }) {
  const { t } = useI18n();
  const idx = Math.max(0, STEPS.indexOf(order.status as (typeof STEPS)[number]));
  const msg = { received: t('stRecv'), preparing: t('stPrep'), ready: t('stReady'), served: t('stServed') }[STEPS[idx]];
  const label = { received: t('received'), preparing: t('preparing'), ready: t('ready'), served: t('served') };
  const emoji = { received: '✅', preparing: '🍳', ready: '🔔', served: '😋' }[STEPS[idx]];
  return (
    <section className="mt-6 animate-pop">
      <div className="card overflow-hidden">
        <div className={cx('flex items-center gap-4 p-5', STEPS[idx] === 'ready' ? 'bg-ok/15' : 'bg-brand/10')}>
          <div className={cx('grid h-14 w-14 place-items-center rounded-2xl bg-surface text-3xl shadow-card', STEPS[idx] === 'ready' && 'animate-flash')} aria-hidden>{emoji}</div>
          <div><div className="flex items-center gap-2 text-sm font-semibold text-muted">✓ {t('paid')}{order.sandbox && <SandboxBadge />}</div>
            <div className="text-xl font-extrabold leading-tight" role="status">{msg}</div>
            {STEPS[idx] !== 'served' && STEPS[idx] !== 'ready' && <div className="text-sm text-muted">{t('eta')} ~{order.etaMinutes} {t('min')}</div>}</div>
        </div>
        <ol className="grid grid-cols-4 gap-1 p-5" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-col items-center gap-2 text-center" aria-current={i === idx ? 'step' : undefined}>
              <div className="relative flex w-full items-center justify-center">
                <span className={cx('absolute left-0 right-1/2 h-1 rounded', i <= idx ? 'bg-brand' : 'bg-line', i === 0 && 'hidden')} /><span className={cx('absolute left-1/2 right-0 h-1 rounded', i < idx ? 'bg-brand' : 'bg-line', i === 3 && 'hidden')} />
                <span className={cx('relative grid h-8 w-8 place-items-center rounded-full text-sm font-bold transition', i <= idx ? 'bg-brand text-onbrand' : 'bg-sunken text-muted', i === idx && STEPS[idx] !== 'served' && 'ring-4 ring-brand/25')}>{i < idx ? '✓' : i + 1}</span></div>
              <span className={cx('text-[11px] font-bold leading-tight', i <= idx ? 'text-ink' : 'text-muted')}>{label[s]}</span>
            </li>))}
        </ol>
        <div className="flex gap-3 border-t border-line p-4"><Link className="btn btn-line btn-sm flex-1" href={`/o/${order.id}/receipt?t=${tk}`}>🧾 {t('viewReceipt')}</Link></div>
      </div>
      {['ready', 'served'].includes(order.status) && <Feedback order={order} tk={tk} reload={reload} />}
    </section>
  );
}

function Feedback({ order, tk, reload }: { order: OrderView; tk: string; reload: () => void }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  if (order.feedbackGiven) return <div className="card mt-4 p-5 text-center font-bold">{t('thanks')} {'★'.repeat(order.feedbackGiven)}</div>;
  return (
    <div className="card mt-4 p-5">
      <h3 className="text-center font-extrabold">{t('rateTitle')}</h3>
      <div className="my-3 flex justify-center gap-1" role="radiogroup" aria-label={t('rateTitle')}>{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n}`} onClick={() => setRating(n)} className={cx('h-12 w-12 text-3xl transition active:scale-90', n <= rating ? 'text-brand2' : 'text-line')}>★</button>)}</div>
      {rating > 0 && <><textarea className="input min-h-[70px]" maxLength={500} placeholder={t('comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="btn btn-brand mt-3 w-full" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/public/orders/${order.id}/feedback?t=${tk}`, { body: { rating, comment: comment || undefined } }); reload(); } finally { setBusy(false); } }}>{t('rateSend')}</button></>}
    </div>
  );
}

function Summary({ order }: { order: OrderView }) {
  const { t, lang } = useI18n();
  return (
    <section className="card mt-5 p-4 text-[15px]">
      <ul className="space-y-2">{order.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span><b className="tabular">{i.qty}×</b> {tr(i.name, lang)}{i.options.length > 0 && <span className="block text-xs text-muted">{i.options.map((o) => tr(o.name, lang)).join(', ')}</span>}{i.note && <span className="block text-xs italic text-muted">“{i.note}”</span>}</span><span className="tabular">{lkr(i.lineTotalCents)}</span></li>)}</ul>
      <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between text-muted"><span>{t('subtotal')}</span><span className="tabular">{lkr(order.totals.subtotal)}</span></div>
        {order.totals.service > 0 && <div className="flex justify-between text-muted"><span>{t('serviceCharge')}</span><span className="tabular">{lkr(order.totals.service)}</span></div>}
        {order.totals.tax > 0 && <div className="flex justify-between text-muted"><span>{order.rates.taxLabel}</span><span className="tabular">{lkr(order.totals.tax)}</span></div>}
        <div className="flex justify-between pt-1 text-lg font-extrabold"><span>{t('total')}</span><span className="tabular">{lkr(order.totals.total)}</span></div>
        <div className="pt-1 text-xs text-muted">{t('orderPlacedAt')} {time(order.createdAt)}</div>
      </div>
    </section>
  );
}
