'use client';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n, tr, type L10n, type Lang } from '@/lib/i18n';
import { brandVars, useTheme } from '@/lib/theme';
import { LangSwitcher, ThemeToggle, SandboxBanner, Spinner, cx } from './ui';
import { useLocalState } from '@/lib/hooks';

export interface Option { id: string; name: L10n; priceDeltaCents: number; available: boolean }
export interface OptionGroup { id: string; name: L10n; min: number; max: number; options: Option[] }
export interface MenuItem { id: string; name: L10n; description: L10n; priceCents: number; imageUrl: string | null; available: boolean; tags: string[]; prepMinutes: number; optionGroups: OptionGroup[] }
export interface Category { id: string; name: L10n; items: MenuItem[] }
export interface Branding { primary?: string; secondary?: string; font?: 'modern' | 'classic' | 'rounded'; theme?: 'light' | 'dark' | 'auto'; logoUrl?: string | null; tagline?: string }
export interface TableCtx {
  restaurant: { name: string; slug: string; branding: Branding; defaultLang: Lang; serviceChargeBps: number; taxBps: number; taxLabel: string; currency: string };
  table: { id: string; label: string }; menu: Category[]; sandbox: boolean;
}
export interface CartLine { key: string; itemId: string; qty: number; optionIds: string[]; note?: string }

/** Applies restaurant branding (accessible colours, font, theme default) to a subtree. */
export function BrandShell({ branding, sandbox, children, defaultLang }: { branding?: Branding; sandbox?: boolean; children: ReactNode; defaultLang?: Lang }) {
  const theme = useTheme(branding?.theme ?? 'auto');
  const { t, setLang } = useI18n();
  useEffect(() => { try { if (defaultLang && !localStorage.getItem('tf-lang')) setLang(defaultLang); } catch { /* ignore */ } }, [defaultLang]); // eslint-disable-line react-hooks/exhaustive-deps
  const vars = useMemo(() => brandVars(branding, theme.dark), [branding, theme.dark]);
  return (
    <div style={vars as CSSProperties} data-font={branding?.font ?? 'modern'} className="min-h-dvh bg-bg">
      {sandbox && <SandboxBanner text={t('sandboxBanner')} />}
      <div className="relative mx-auto w-full max-w-[560px]"><ThemeCtlHost theme={theme} />{children}</div>
    </div>
  );
}
// floating controls (language + theme) rendered once per shell
function ThemeCtlHost({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return <div className="absolute right-3 top-3 z-30 flex items-center gap-2 print:hidden"><LangSwitcher className="shadow-card" /><ThemeToggle dark={theme.dark} onToggle={theme.toggle} /></div>;
}

export function useTableCtx(token: string) {
  const [data, setData] = useState<TableCtx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<TableCtx>(`/api/public/t/${token}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: load };
}

export function useCart(token: string) {
  const [lines, setLines] = useLocalState<CartLine[]>(`tf-cart-${token}`, []);
  const add = (l: Omit<CartLine, 'key'>) => setLines((cur) => {
    const key = [l.itemId, [...l.optionIds].sort().join('+'), l.note ?? ''].join('|');
    const hit = cur.find((x) => x.key === key);
    return hit ? cur.map((x) => (x.key === key ? { ...x, qty: Math.min(50, x.qty + l.qty) } : x)) : [...cur, { ...l, key }];
  });
  const setQty = (key: string, qty: number) => setLines((cur) => (qty <= 0 ? cur.filter((x) => x.key !== key) : cur.map((x) => (x.key === key ? { ...x, qty } : x))));
  return { lines, add, setQty, clear: () => setLines([]), count: lines.reduce((s, l) => s + l.qty, 0) };
}

export function localTotal(menu: Category[], lines: CartLine[]) {
  const items = new Map(menu.flatMap((c) => c.items).map((i) => [i.id, i]));
  return lines.reduce((s, l) => {
    const it = items.get(l.itemId); if (!it) return s;
    const extra = it.optionGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).reduce((a, o) => a + o.priceDeltaCents, 0);
    return s + (it.priceCents + extra) * l.qty;
  }, 0);
}

export interface MethodInfo { method: 'lankaqr' | 'card'; available: boolean; reason?: string; recommended: boolean; sandbox: boolean; capabilities: { deepLink: boolean } }

/** "Choose how to pay". Hides unconfigured methods (server-side) and explains unavailable ones. */
export function PaymentSelector({ methods, value, onChange }: { methods: MethodInfo[] | null; value: string | null; onChange: (m: 'lankaqr' | 'card') => void }) {
  const { t } = useI18n();
  if (!methods) return <div className="flex items-center gap-3 p-4 text-muted"><Spinner /> {t('loading')}</div>;
  const qr = methods.find((m) => m.method === 'lankaqr'), card = methods.find((m) => m.method === 'card');
  return (
    <div className="space-y-3" role="radiogroup" aria-label={t('chooseHowToPay')}>
      {qr && !qr.available && <div role="status" className="rounded-2xl border border-warn/40 bg-warn/10 p-3.5 text-sm font-medium text-warn">{t('lankaqrUnavailable')}</div>}
      {card && !card.available && <div role="status" className="rounded-2xl border border-warn/40 bg-warn/10 p-3.5 text-sm font-medium text-warn">{t('cardUnavailable')}</div>}
      {qr?.available && <Method id="lankaqr" active={value === 'lankaqr'} onClick={() => onChange('lankaqr')} icon={<QrIcon />} title={t('payLankaQR')} sub={t('lankaQRSub')} badge={t('recommended')} />}
      {card?.available && <Method id="card" active={value === 'card'} onClick={() => onChange('card')} icon={<CardIcon />} title={t('payCard')} sub={t('cardSub')} />}
    </div>
  );
}
function Method({ active, onClick, icon, title, sub, badge }: { id: string; active: boolean; onClick: () => void; icon: ReactNode; title: string; sub: string; badge?: string }) {
  return (
    <button role="radio" aria-checked={active} onClick={onClick}
      className={cx('relative flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition active:scale-[.99]', active ? 'border-brand bg-brand/5' : 'border-line bg-surface hover:border-muted/40')}>
      <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-xl', active ? 'bg-brand text-onbrand' : 'bg-sunken text-ink')}>{icon}</span>
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-bold">{title}{badge && <span className="rounded-full bg-brand2/25 px-2 py-0.5 text-[11px] font-bold text-ink">{badge}</span>}</span>
        <span className="mt-0.5 block text-sm text-muted">{sub}</span></span>
      <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', active ? 'border-brand bg-brand text-onbrand' : 'border-line')}>{active && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>}</span>
    </button>
  );
}
export const QrIcon = () => <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3m4 0v4h-4m-3-3v3" /></svg>;
export const CardIcon = () => <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6 15h4" /></svg>;

export const FoodImg = ({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) =>
  src ? <img src={src} alt={alt} loading="lazy" decoding="async" className={cx('object-cover', className)} /> : <div className={cx('grid place-items-center bg-sunken text-3xl', className)} aria-hidden>🍽️</div>;

export const optionLabel = (names: L10n[], lang: Lang) => names.map((n) => tr(n, lang)).join(', ');
