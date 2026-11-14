'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, newKey } from '@/lib/api';
import { useI18n, tr } from '@/lib/i18n';
import { lkr } from '@/lib/money';
import { BrandShell, FoodImg, PaymentSelector, useCart, useTableCtx, optionLabel, type MethodInfo } from '@/components/customer';
import { Spinner, Stepper } from '@/components/ui';

interface Quote { subtotal: number; service: number; tax: number; total: number; lines: { itemId: string; unitPriceCents: number; lineTotalCents: number }[] }

export default function Checkout({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, reload } = useTableCtx(token);
  const cart = useCart(token);
  const router = useRouter();
  const { t, lang } = useI18n();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [methods, setMethods] = useState<MethodInfo[] | null>(null);
  const [method, setMethod] = useState<'lankaqr' | 'card' | null>(null);
  const [cust, setCust] = useState({ name: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const created = useRef<{ orderId: string; trackingToken: string } | null>(null);

  const sig = useMemo(() => JSON.stringify(cart.lines.map((l) => [l.itemId, l.qty, l.optionIds, l.note])), [cart.lines]);
  const loadMethods = () => api<{ methods: MethodInfo[] }>(`/api/public/t/${token}/methods`).then((r) => {
    setMethods(r.methods);
    setMethod((cur) => { const ok = (m: string) => r.methods.some((x) => x.method === m && x.available); return cur && ok(cur) ? cur : ok('lankaqr') ? 'lankaqr' : ok('card') ? 'card' : null; });
  }).catch(() => setMethods([]));
  useEffect(() => { loadMethods(); const i = setInterval(loadMethods, 20000); return () => clearInterval(i); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {   // server-side pricing is the source of truth for what the customer sees and pays
    if (!cart.lines.length) { setQuote(null); return; }
    const c = new AbortController();
    api<Quote>(`/api/public/t/${token}/quote`, { body: { items: cart.lines.map(({ itemId, qty, optionIds, note }) => ({ itemId, qty, optionIds, note })) }, signal: c.signal })
      .then((q) => { setQuote(q); setErr(null); }).catch((e) => { if (e.name !== 'AbortError') setErr(e instanceof ApiError && e.code === 'unavailable' ? 'An item in your order just sold out. Please remove it.' : e.message); });
    return () => c.abort();
  }, [sig, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="grid min-h-dvh place-items-center text-muted"><Spinner /></div>;
  const items = new Map(data.menu.flatMap((c) => c.items).map((i) => [i.id, i]));

  async function pay() {
    if (!quote || !method) return;
    setBusy(true); setErr(null);
    try {
      // One idempotency key per distinct cart: double-taps and retries can never create two orders.
      if (!idem.current || idem.current.sig !== sig) { idem.current = { sig, key: newKey() }; created.current = null; }
      if (!created.current) {
        const o = await api<{ orderId: string; trackingToken: string }>(`/api/public/t/${token}/orders`, { headers: { 'idempotency-key': idem.current.key },
          body: { items: cart.lines.map(({ itemId, qty, optionIds, note }) => ({ itemId, qty, optionIds, note })), customer: { name: cust.name || undefined, phone: cust.phone || undefined, email: cust.email || undefined }, lang } });
        created.current = { orderId: o.orderId, trackingToken: o.trackingToken };
      }
      const { orderId, trackingToken } = created.current;
      await api(`/api/public/orders/${orderId}/payments?t=${trackingToken}`, { headers: { 'idempotency-key': `${idem.current.key}-${method}` }, body: { method } });
      cart.clear();
      router.push(`/o/${orderId}?t=${trackingToken}`);
    } catch (e) {
      const ex = e as ApiError;
      if (ex.code === 'method_unavailable' || ex.code === 'provider_error') { await loadMethods(); setMethod(ex.data?.fallback ?? null); setErr(ex.data?.fallback === 'card' ? t('lankaqrUnavailable') : ex.message); }
      else if (ex.code === 'unavailable' || ex.code === 'unknown_item') { setErr(ex.message); reload(); }
      else setErr(ex.message);
      setBusy(false);
    }
  }

  const methodReady = !!method && !!methods?.some((m) => m.method === method && m.available);
  return (
    <BrandShell branding={data.restaurant.branding} sandbox={data.sandbox} defaultLang={data.restaurant.defaultLang}>
      <div className="px-5 pb-40 pt-16">
        <Link href={`/t/${token}`} className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-brandtext">← {t('back')}</Link>
        <h1 className="font-display text-3xl font-extrabold">{t('yourOrder')}</h1>
        <p className="mt-1 text-sm text-muted">{data.restaurant.name} · {t('table')} {data.table.label}</p>

        {cart.lines.length === 0 ? (
          <div className="mt-16 text-center"><div className="text-5xl">🛒</div><p className="mt-3 font-semibold">{t('emptyCart')}</p><Link className="btn btn-brand mt-6" href={`/t/${token}`}>{t('browseMenu')}</Link></div>
        ) : (<>
          <ul className="mt-5 space-y-3">
            {cart.lines.map((l) => { const it = items.get(l.itemId); if (!it) return null;
              const opts = it.optionGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id));
              const line = quote && quote.lines.length === cart.lines.length ? quote.lines[cart.lines.indexOf(l)] : undefined;
              return (
                <li key={l.key} className="card flex gap-3 p-3">
                  <FoodImg src={it.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1"><div className="font-bold leading-tight">{tr(it.name, lang)}</div>
                    {opts.length > 0 && <div className="text-xs text-muted">{optionLabel(opts.map((o) => o.name), lang)}</div>}
                    {l.note && <div className="text-xs italic text-muted">“{l.note}”</div>}
                    <div className="mt-2 flex items-center justify-between"><Stepper value={l.qty} min={0} onChange={(n) => cart.setQty(l.key, n)} />
                      <span className="font-bold tabular">{line ? lkr(line.lineTotalCents) : '…'}</span></div></div>
                </li>); })}
          </ul>

          <section className="card mt-5 space-y-2 p-4 text-[15px]" aria-label="Order totals">
            <Row k={t('subtotal')} v={quote ? lkr(quote.subtotal) : '…'} />
            {quote && quote.service > 0 && <Row k={`${t('serviceCharge')} (${data.restaurant.serviceChargeBps / 100}%)`} v={lkr(quote.service)} />}
            {quote && quote.tax > 0 && <Row k={`${data.restaurant.taxLabel} (${data.restaurant.taxBps / 100}%)`} v={lkr(quote.tax)} />}
            <div className="border-t border-line pt-3"><Row k={t('total')} v={quote ? lkr(quote.total) : '…'} big /></div>
          </section>

          <details className="card mt-5 p-4"><summary className="cursor-pointer font-bold">{t('yourDetails')}</summary>
            <div className="mt-3 space-y-3">
              <label className="block"><span className="label">{t('name')}</span><input className="input" autoComplete="name" value={cust.name} maxLength={60} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></label>
              <label className="block"><span className="label">{t('phone')}</span><input className="input" inputMode="tel" autoComplete="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} placeholder="07X XXX XXXX" /></label>
              <label className="block"><span className="label">{t('email')}</span><input className="input" type="email" inputMode="email" autoComplete="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} /></label>
            </div></details>

          <h2 className="mb-3 mt-7 text-lg font-extrabold">{t('chooseHowToPay')}</h2>
          <PaymentSelector methods={methods} value={method} onChange={setMethod} />
          {err && <div role="alert" className="mt-4 rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-sm font-medium text-bad">{err}</div>}
        </>)}
      </div>
      {cart.lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur"><div className="mx-auto max-w-[560px] px-4 pt-3 safe-b">
          <button className="btn btn-brand w-full py-4 text-base" disabled={busy || !quote || !methodReady} onClick={pay}>
            {busy ? <><Spinner /> {t('placing')}</> : <>{method === 'card' ? <>💳</> : <>▦</>} {t('payNow')} {quote ? lkr(quote.total) : ''}</>}</button>
        </div></div>
      )}
    </BrandShell>
  );
}
const Row = ({ k, v, big }: { k: string; v: string; big?: boolean }) => <div className={`flex items-baseline justify-between gap-4 ${big ? 'text-lg font-extrabold' : ''}`}><span className={big ? '' : 'text-muted'}>{k}</span><span className="tabular">{v}</span></div>;
