import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { STATUS_LABELS, type StatusKey } from '@staffhub/theme-core';
import { Icon, STATUS_ICON, type IconName } from './icons.tsx';
import { useScheme } from './scheme.tsx';

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

// ─────────── buttons ───────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
  /** Pins an interaction state so previews can show hover / pressed / focus side by side. */
  forceState?: 'hover' | 'active' | 'focus';
}
export function Button({ variant = 'primary', size = 'md', icon, forceState, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('ds-btn', `ds-btn--${variant}`, size === 'sm' && 'ds-btn--sm', forceState && `is-${forceState}`, className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  );
}

// ─────────── surfaces ───────────

export function Card({ title, actions, children, className, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx('ds-card', className)}>
      {(title || actions) && (
        <header className="ds-card__head">
          {title && <h2 className="ds-card__title">{title}</h2>}
          {actions && <div className="ds-card__actions">{actions}</div>}
        </header>
      )}
      <div className={cx('ds-card__body', flush && 'is-flush')}>{children}</div>
    </section>
  );
}

export function KpiTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: IconName }) {
  return (
    <div className="ds-kpi">
      <div className="ds-kpi__top">{icon && <span className="ds-kpi__icon"><Icon name={icon} size={16} /></span>}<span className="ds-kpi__label">{label}</span></div>
      <div className="ds-kpi__value">{value}</div>
      {hint && <div className="ds-kpi__hint">{hint}</div>}
    </div>
  );
}

// ─────────── status ───────────

/**
 * Leave status. Always shows a distinct icon *and* a text label, so meaning never depends on colour alone
 * (WCAG 1.4.1). `compact` hides the label visually (it stays available to assistive tech and as a tooltip).
 */
export function StatusBadge({ status, compact }: { status: StatusKey; compact?: boolean }) {
  const label = STATUS_LABELS[status];
  return (
    <span className={cx('ds-status', compact && 'ds-status--compact')} data-status={status} title={label}>
      <Icon name={STATUS_ICON[status]} size={compact ? 14 : 15} />
      <span className={compact ? 'ds-sr-only' : undefined}>{label}</span>
    </span>
  );
}

export function Notice({ tone = 'info', title, children, icon }: { tone?: 'info' | StatusKey; title?: ReactNode; children?: ReactNode; icon?: IconName }) {
  const name: IconName = icon ?? (tone === 'info' ? 'info' : STATUS_ICON[tone]);
  return (
    <div className="ds-notice" data-tone={tone} role={tone === 'rejected' ? 'alert' : 'status'}>
      <Icon name={name} size={18} />
      <div>{title && <strong className="ds-notice__title">{title}</strong>}{children && <div className="ds-notice__text">{children}</div>}</div>
    </div>
  );
}

export function NotificationItem({ status, title, body, time, unread }: { status?: StatusKey | null; title: string; body: string; time?: string; unread?: boolean }) {
  return (
    <li className={cx('ds-note', unread && 'is-unread')} data-tone={status ?? 'info'}>
      <span className="ds-note__icon"><Icon name={status ? STATUS_ICON[status] : 'info'} size={17} /></span>
      <div className="ds-note__main">
        <div className="ds-note__title">{title}{unread && <><span className="ds-note__dot" aria-hidden="true" /><span className="ds-sr-only">(unread)</span></>}</div>
        <div className="ds-note__body">{body}</div>
        {time && <div className="ds-note__time">{time}</div>}
      </div>
    </li>
  );
}

// ─────────── identity ───────────

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return <span className="ds-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(name)}</span>;
}

/**
 * Company/property mark. Uses the uploaded logo (and its dark-mode variant when one exists); otherwise a
 * generated monogram in the brand colour. Never ships a third-party logo.
 */
export function BrandLogo({ name, logoUrl, logoDarkUrl, height = 32, showName }: { name: string; logoUrl?: string | null; logoDarkUrl?: string | null; height?: number; showName?: boolean }) {
  const scheme = useScheme();
  const src = scheme === 'dark' && logoDarkUrl ? logoDarkUrl : logoUrl;
  // A logo supplied for light backgrounds is shown on a light plate in dark mode, so it never disappears into the page.
  const plate = scheme === 'dark' && !!logoUrl && !logoDarkUrl;
  return (
    <span className={cx('ds-logo', plate && 'has-plate')}>
      {src
        ? <img className="ds-logo__img" src={src} alt={showName ? '' : name} style={{ height }} />
        : <span className="ds-logo__mono" style={{ width: height, height, fontSize: height * 0.4 }} aria-hidden={showName ? true : undefined}>{initials(name)}</span>}
      {(showName || !src) && <span className="ds-logo__name">{name}</span>}
    </span>
  );
}

// ─────────── forms ───────────

export function Field({ label, hint, error, htmlFor, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="ds-field">
      <label className="ds-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <div className="ds-hint">{hint}</div>}
      {error && <div className="ds-error" role="alert"><Icon name="alert" size={14} /> {error}</div>}
    </div>
  );
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx('ds-input', className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx('ds-input ds-select', className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cx('ds-input ds-textarea', className)} {...p} />;

export function Checkbox({ label, hint, ...p }: { label: ReactNode; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className="ds-check">
      <input type="checkbox" {...p} />
      <span><span className="ds-check__label">{label}</span>{hint && <span className="ds-hint">{hint}</span>}</span>
    </label>
  );
}

// ─────────── navigation ───────────

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: string; icon?: IconName; badge?: ReactNode }>; value: T; onChange: (id: T) => void; label: string }) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.id);
    (e.currentTarget.parentElement?.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="ds-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} role="tab" type="button" data-tab={t.id} aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
          className={cx('ds-tab', t.id === value && 'is-active')} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.icon && <Icon name={t.icon} size={16} />}<span>{t.label}</span>{t.badge}
        </button>
      ))}
    </div>
  );
}

export function NavItem({ icon, label, href, active, onNavigate, badge }: { icon: IconName; label: string; href: string; active?: boolean; onNavigate?: (href: string) => void; badge?: ReactNode }) {
  return (
    <a className={cx('ds-nav-item', active && 'is-active')} href={href} aria-current={active ? 'page' : undefined}
      onClick={(e) => { if (onNavigate && !e.metaKey && !e.ctrlKey && e.button === 0) { e.preventDefault(); onNavigate(href); } }}>
      <Icon name={icon} size={19} /><span className="ds-nav-item__label">{label}</span>{badge}
    </a>
  );
}

/**
 * Responsive application frame. It adapts to the width of its *container* (not the viewport), so the exact same
 * markup renders the desktop sidebar layout or the phone bottom-bar layout, including inside a preview frame.
 */
export function AppShell({ brand, nav, navFooter, title, actions, children }: { brand: ReactNode; nav: ReactNode; navFooter?: ReactNode; title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-shell">
      <aside className="ds-nav" aria-label="Main">
        <div className="ds-nav__sticky">
          <div className="ds-nav__brand">{brand}</div>
          <nav className="ds-nav__items">{nav}</nav>
          {navFooter && <div className="ds-nav__footer">{navFooter}</div>}
        </div>
      </aside>
      <div className="ds-main">
        <header className="ds-topbar">
          <div className="ds-topbar__brand">{brand}</div>
          {title && <h1 className="ds-topbar__title">{title}</h1>}
          <div className="ds-topbar__actions">{actions}</div>
        </header>
        <main className="ds-content">{children}</main>
      </div>
    </div>
  );
}

// ─────────── dialog ───────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={cx('ds-modal', wide && 'ds-modal--wide')} onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={typeof title === 'string' ? title : undefined}>
      {open && (
        <div className="ds-modal__panel">
          <header className="ds-modal__head"><h2>{title}</h2><button type="button" className="ds-iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
          <div className="ds-modal__body">{children}</div>
          {footer && <footer className="ds-modal__foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="ds-empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
