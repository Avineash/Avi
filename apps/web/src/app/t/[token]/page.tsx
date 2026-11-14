'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n, tr } from '@/lib/i18n';
import { lkr } from '@/lib/money';
import { BrandShell, FoodImg, useCart, useTableCtx, localTotal, optionLabel, type Category, type MenuItem } from '@/components/customer';
import { Sheet, Stepper, Spinner, cx } from '@/components/ui';

export default function MenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, error } = useTableCtx(token);
  const cart = useCart(token);
  const [picked, setPicked] = useState<MenuItem | null>(null);
  const { t } = useI18n();

  if (error) return <div className="grid min-h-dvh place-items-center p-8 text-center"><div><div className="mb-3 text-5xl">🔒</div><p className="font-semibold">{t('qrInvalid')}</p></div></div>;
  if (!data) return <div className="grid min-h-dvh place-items-center text-muted"><Spinner /></div>;
  const { restaurant: r, table, menu } = data;
  const total = localTotal(menu, cart.lines);

  return (
    <BrandShell branding={r.branding} sandbox={data.sandbox} defaultLang={r.defaultLang}>
      <MenuBody token={token} data={data} onPick={setPicked} />
      {cart.count > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[560px] px-4 safe-b">
          <Link href={`/t/${token}/checkout`} className="btn btn-brand pointer-events-auto w-full animate-pop justify-between rounded-2xl py-4 text-base shadow-pop" aria-label={`${t('viewOrder')}: ${cart.count} ${t('items')}, ${lkr(total)}`}>
            <span className="flex items-center gap-3"><span className="grid h-7 min-w-7 place-items-center rounded-full bg-onbrand/20 px-2 text-sm tabular">{cart.count}</span>{t('viewOrder')}</span>
            <span className="tabular">{lkr(total)}</span>
          </Link>
        </div>
      )}
      <ItemSheet item={picked} onClose={() => setPicked(null)} onAdd={(l) => { cart.add(l); setPicked(null); }} />
      <span className="sr-only">{table.label}</span>
    </BrandShell>
  );
}

function MenuBody({ token, data, onPick }: { token: string; data: NonNullable<ReturnType<typeof useTableCtx>['data']>; onPick: (i: MenuItem) => void }) {
  const { t, lang } = useI18n();
  const { restaurant: r, table, menu } = data;
  const [active, setActive] = useState(menu[0]?.id);
  const tabs = useRef<HTMLDivElement>(null);
  const popular = useMemo(() => menu.flatMap((c) => c.items).filter((i) => i.tags.includes('popular') && i.available), [menu]);
  const inCart = useCart(token);

  useEffect(() => {
    const obs = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id.replace('cat-', '')); }, { rootMargin: '-120px 0px -65% 0px' });
    menu.forEach((c) => { const el = document.getElementById(`cat-${c.id}`); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [menu]);
  useEffect(() => { tabs.current?.querySelector<HTMLElement>(`[data-cat="${active}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [active]);

  const qtyOf = (id: string) => inCart.lines.filter((l) => l.itemId === id).reduce((s, l) => s + l.qty, 0);

  return (
    <div className="pb-32">
      <header className="relative overflow-hidden px-5 pb-6 pt-16" style={{ background: 'linear-gradient(160deg, rgb(var(--brand)) 0%, rgb(var(--brand) / .82) 60%, rgb(var(--brand2) / .9) 160%)' }}>
        <div className="flex items-center gap-4">
          {r.branding.logoUrl ? <img src={r.branding.logoUrl} alt="" className="h-14 w-14 rounded-2xl bg-white object-cover shadow-card" />
            : <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/90 text-2xl font-black text-brand shadow-card" aria-hidden>{r.name[0]}</div>}
          <div className="min-w-0 text-onbrand"><h1 className="font-display text-2xl font-extrabold leading-tight">{r.name}</h1>
            {r.branding.tagline && <p className="mt-0.5 text-sm opacity-90">{r.branding.tagline}</p>}</div>
        </div>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-black/20 px-3.5 py-1.5 text-sm font-bold text-onbrand backdrop-blur"><span aria-hidden>📍</span>{t('table')} {table.label}</div>
      </header>

      <nav aria-label="Menu categories" className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div ref={tabs} className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
          {menu.map((c) => <a key={c.id} data-cat={c.id} href={`#cat-${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            aria-current={active === c.id}
            className={cx('whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition', active === c.id ? 'bg-brand text-onbrand shadow-card' : 'bg-sunken text-ink')}>{tr(c.name, lang)}</a>)}
        </div>
      </nav>

      {popular.length > 0 && (
        <section aria-label={t('popular')} className="pt-6">
          <h2 className="px-5 pb-3 text-lg font-extrabold">🔥 {t('popular')}</h2>
          <div className="no-scrollbar flex snap-x gap-4 overflow-x-auto px-5 pb-2">
            {popular.map((i) => (
              <button key={i.id} onClick={() => onPick(i)} className="group w-[72%] shrink-0 snap-start overflow-hidden rounded-3xl bg-surface text-left shadow-card ring-1 ring-line transition active:scale-[.98] sm:w-64">
                <div className="relative"><FoodImg src={i.imageUrl} alt={tr(i.name, lang)} className="aspect-[4/3] w-full transition duration-500 group-hover:scale-105" />
                  <span className="absolute bottom-2.5 right-2.5 grid h-10 w-10 place-items-center rounded-full bg-brand text-xl font-bold text-onbrand shadow-pop" aria-hidden>+</span>
                  {qtyOf(i.id) > 0 && <span className="absolute left-2.5 top-2.5 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-onbrand">×{qtyOf(i.id)}</span>}</div>
                <div className="p-3.5"><div className="line-clamp-1 font-bold">{tr(i.name, lang)}</div><div className="mt-0.5 font-semibold text-brandtext tabular">{lkr(i.priceCents)}</div></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {menu.map((c: Category) => (
        <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-16 px-5 pt-8">
          <h2 className="mb-3 text-xl font-extrabold">{tr(c.name, lang)}</h2>
          <ul className="space-y-3">
            {c.items.map((i) => (
              <li key={i.id}>
                <button disabled={!i.available} onClick={() => onPick(i)} className={cx('card flex w-full gap-3 p-3 text-left transition active:scale-[.99]', !i.available && 'opacity-55')}>
                  <div className="min-w-0 flex-1 py-1">
                    <div className="flex items-center gap-2"><span className="font-bold leading-snug">{tr(i.name, lang)}</span>{i.tags.includes('vegetarian') && <span title="Vegetarian" aria-label="Vegetarian">🌱</span>}</div>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">{tr(i.description, lang)}</p>
                    <div className="mt-2 flex items-center gap-2"><span className="font-bold tabular">{lkr(i.priceCents)}</span>{!i.available && <span className="pill bg-bad/15 text-bad">{t('soldOut')}</span>}
                      {qtyOf(i.id) > 0 && <span className="pill bg-brand/15 text-brandtext">×{qtyOf(i.id)}</span>}</div>
                  </div>
                  <div className="relative shrink-0"><FoodImg src={i.imageUrl} alt="" className="h-[104px] w-[104px] rounded-2xl" />
                    {i.available && <span className="absolute -bottom-2 -right-2 grid h-9 w-9 place-items-center rounded-full bg-brand text-lg font-bold text-onbrand shadow-card" aria-hidden>+</span>}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <footer className="px-5 pb-10 pt-10 text-center text-xs text-muted">{t('scanTagline')}<br />Powered by TableFlow</footer>
    </div>
  );
}

function ItemSheet({ item, onClose, onAdd }: { item: MenuItem | null; onClose: () => void; onAdd: (l: { itemId: string; qty: number; optionIds: string[]; note?: string }) => void }) {
  const { t, lang } = useI18n();
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  useEffect(() => { if (item) { setQty(1); setNote(''); setSel(Object.fromEntries(item.optionGroups.filter((g) => g.min === 1 && g.max === 1 && g.options[0]).map((g) => [g.id, [g.options.find((o) => o.available)?.id ?? g.options[0].id]]))); } }, [item]);
  if (!item) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const chosen = item.optionGroups.flatMap((g) => g.options.filter((o) => (sel[g.id] ?? []).includes(o.id)));
  const unit = item.priceCents + chosen.reduce((s, o) => s + o.priceDeltaCents, 0);
  const valid = item.optionGroups.every((g) => { const n = (sel[g.id] ?? []).length; return n >= g.min && n <= g.max; });
  const toggle = (gid: string, oid: string, max: number) => setSel((s) => { const cur = s[gid] ?? []; if (max === 1) return { ...s, [gid]: [oid] }; return { ...s, [gid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : cur.length < max ? [...cur, oid] : cur }; });

  return (
    <Sheet open onClose={onClose}
      footer={<div className="flex items-center gap-3"><Stepper value={qty} onChange={setQty} />
        <button className="btn btn-brand flex-1 justify-between" disabled={!valid} onClick={() => onAdd({ itemId: item.id, qty, optionIds: Object.values(sel).flat(), note: note.trim() || undefined })}>
          <span>{t('addToOrder')}</span><span className="tabular">{lkr(unit * qty)}</span></button></div>}>
      <div className="relative"><FoodImg src={item.imageUrl} alt={tr(item.name, lang)} className="aspect-[4/3] w-full" />
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/45 text-xl text-white backdrop-blur">×</button></div>
      <div className="space-y-5 p-5">
        <div><h2 className="font-display text-2xl font-extrabold">{tr(item.name, lang)}</h2><p className="mt-1 text-muted">{tr(item.description, lang)}</p>
          <div className="mt-2 text-lg font-bold tabular">{lkr(item.priceCents)}</div></div>
        {item.optionGroups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 flex w-full items-center justify-between font-bold">{tr(g.name, lang)}
              <span className={cx('pill', g.min > 0 ? 'bg-brand/15 text-brandtext' : 'bg-sunken text-muted')}>{g.min > 0 ? t('required') : g.max > 1 ? `${t('chooseUpTo')} ${g.max}` : t('choose')}</span></legend>
            <div className="space-y-2">
              {g.options.map((o) => { const on = (sel[g.id] ?? []).includes(o.id); return (
                <label key={o.id} className={cx('flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 transition', on ? 'border-brand bg-brand/5' : 'border-line', !o.available && 'pointer-events-none opacity-40')}>
                  <input type={g.max === 1 ? 'radio' : 'checkbox'} name={g.id} checked={on} disabled={!o.available} onChange={() => toggle(g.id, o.id, g.max)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                  <span className="flex-1 font-medium">{tr(o.name, lang)}</span>
                  {o.priceDeltaCents !== 0 && <span className="text-sm font-semibold text-muted tabular">{o.priceDeltaCents > 0 ? '+' : '−'}{lkr(Math.abs(o.priceDeltaCents))}</span>}
                </label>); })}
            </div>
          </fieldset>
        ))}
        <label className="block"><span className="mb-2 block font-bold">{t('specialInstructions')}</span>
          <textarea className="input min-h-[84px]" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} /></label>
        <span className="sr-only">{optionLabel(chosen.map((c) => c.name), lang)}</span>
      </div>
    </Sheet>
  );
}
