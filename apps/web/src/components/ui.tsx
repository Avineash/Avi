'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { LANGS, useI18n } from '@/lib/i18n';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} role="status" aria-label="Loading" />;
}
export const Loading = ({ label = 'Loading…' }: { label?: string }) => <div className="flex items-center justify-center gap-3 p-10 text-muted"><Spinner /> {label}</div>;

export function ErrorBox({ error, retry }: { error: { message: string } | null; retry?: () => void }) {
  if (!error) return null;
  return <div role="alert" className="card flex items-center justify-between gap-3 border-bad/40 bg-bad/5 p-4 text-sm text-bad"><span>{error.message}</span>{retry && <button className="btn btn-line btn-sm" onClick={retry}>Retry</button>}</div>;
}

/** Bottom sheet on phones, centred dialog on larger screens. Closes on Esc / backdrop. */
export function Sheet({ open, onClose, title, children, wide = false, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50 animate-fade" onClick={onClose} />
      <div className={cx('relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-pop animate-up sm:rounded-3xl sm:animate-pop', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        {title && <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-sunken text-lg">×</button></div>}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line bg-surface p-4 safe-b">{footer}</div>}
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; kind: 'ok' | 'bad' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = ++n.current; setList((l) => [...l, { id, text, kind }]); setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return <ToastCtx.Provider value={push}>{children}
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {list.map((t) => <div key={t.id} className={cx('pointer-events-auto animate-pop rounded-2xl px-4 py-3 text-sm font-semibold shadow-pop', t.kind === 'ok' ? 'bg-ink text-bg' : 'bg-bad text-white')}>{t.text}</div>)}
    </div></ToastCtx.Provider>;
}

export const Pill = ({ tone = 'muted', children }: { tone?: 'ok' | 'warn' | 'bad' | 'brand' | 'muted'; children: ReactNode }) => (
  <span className={cx('pill', tone === 'ok' && 'bg-ok/15 text-ok', tone === 'warn' && 'bg-warn/15 text-warn', tone === 'bad' && 'bg-bad/15 text-bad', tone === 'brand' && 'bg-brand/15 text-brandtext', tone === 'muted' && 'bg-sunken text-muted')}>{children}</span>
);

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'brand' | 'muted'> = {
  paid: 'ok', succeeded: 'ok', active: 'ok', settled: 'ok', clean: 'ok', served: 'ok', resolved: 'ok', received: 'brand', preparing: 'warn', ready: 'ok', pending: 'warn', pending_payment: 'warn', requires_action: 'warn', created: 'muted',
  failed: 'bad', expired: 'muted', cancelled: 'muted', suspended: 'bad', rejected: 'bad', discrepancies: 'bad', paid_duplicate: 'bad', unsupported: 'warn', open: 'warn', in_progress: 'brand', refunded: 'muted', partially_refunded: 'warn', unsettled: 'muted', unpaid: 'warn',
};
export const StatusPill = ({ s }: { s: string }) => <Pill tone={STATUS_TONE[s] ?? 'muted'}>{s.replace(/_/g, ' ')}</Pill>;

export function SandboxBadge({ className = '' }: { className?: string }) {
  return <span className={cx('pill bg-amber-100 text-amber-900 ring-1 ring-amber-400/60', className)} title="Simulated payment — no real money moves">SANDBOX</span>;
}
export function SandboxBanner({ text }: { text: string }) {
  return <div role="note" className="flex items-center justify-center gap-2 bg-warn/15 px-3 py-2 text-center text-xs font-bold tracking-wide text-warn ring-1 ring-inset ring-warn/30"><span aria-hidden>🧪</span>{text}</div>;
}

export function LangSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t('language')} className={cx('inline-flex rounded-full bg-sunken p-1', className)}>
      {LANGS.map((l) => <button key={l.id} onClick={() => setLang(l.id)} aria-pressed={lang === l.id} title={l.long}
        className={cx('min-w-[40px] rounded-full px-2.5 py-1.5 text-xs font-bold transition', lang === l.id ? 'bg-surface text-ink shadow-card' : 'text-muted')}>{l.label}</button>)}
    </div>
  );
}
export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return <button onClick={onToggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} className="grid h-9 w-9 place-items-center rounded-full bg-sunken text-base">{dark ? '☀️' : '🌙'}</button>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}</label>;
}
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
    className={cx('relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40', on ? 'bg-brand' : 'bg-line')}>
    <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} /></button>;
}
export function Stepper({ value, onChange, min = 1, max = 50 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return <div className="inline-flex items-center rounded-full bg-sunken">
    <button className="grid h-11 w-11 place-items-center text-xl font-bold disabled:opacity-30" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
    <span className="w-8 text-center text-base font-bold tabular" aria-live="polite">{value}</span>
    <button className="grid h-11 w-11 place-items-center text-xl font-bold disabled:opacity-30" aria-label="Increase" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button></div>;
}
export function Empty({ icon = '🍽️', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 p-10 text-center"><div className="text-4xl">{icon}</div><div className="font-bold">{title}</div><div className="max-w-xs text-sm text-muted">{children}</div></div>;
}

/** Minimal confirm dialog (replaces window.confirm so it works inside PWAs / webviews). */
export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title={title} footer={<div className="flex gap-3"><button className="btn btn-line flex-1" onClick={onClose}>Cancel</button><button className={cx('btn flex-1', danger ? 'btn-danger' : 'btn-brand')} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></div>}><div className="p-5 text-sm">{body}</div></Sheet>;
}
