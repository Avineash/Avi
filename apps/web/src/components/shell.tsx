'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { cx, Spinner, ThemeToggle, SandboxBadge } from './ui';

export interface Me { id: string; name: string; email: string; role: string; restaurantId: string | null; restaurantName?: string; perms: string[]; sandbox: boolean }
const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const can = (me: Me, p: string) => me.perms.includes(p);

export function useGuard(kind: 'restaurant' | 'platform' | 'any' = 'any') {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>('/api/auth/me').then((m) => {
      const platform = !m.restaurantId;
      if (kind === 'restaurant' && platform) return router.replace('/admin');
      if (kind === 'platform' && !platform) return router.replace('/dashboard');
      setMe(m);
    }).catch(() => router.replace('/login'));
  }, [kind, router]);
  return me;
}
export async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } finally { location.href = '/login'; } }

interface NavItem { href: string; label: string; icon: string; perm?: string }
function Shell({ nav, me, children, brand }: { nav: NavItem[]; me: Me; children: ReactNode; brand: string }) {
  const path = usePathname();
  const theme = useTheme('auto');
  const items = nav.filter((n) => !n.perm || can(me, n.perm));
  const active = (h: string) => (h === '/dashboard' || h === '/admin' ? path === h : path.startsWith(h));
  return (
    <MeCtx.Provider value={me}>
      <div className="min-h-dvh lg:flex">
        <aside className="sticky top-0 z-20 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
          <div className="mb-6 flex items-center gap-2.5 px-2 pt-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand font-black text-onbrand">T</span>
            <div className="min-w-0"><div className="font-extrabold leading-none">TableFlow</div><div className="mt-1 truncate text-xs text-muted">{brand}</div></div></div>
          <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Main">
            {items.map((n) => <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
              className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', active(n.href) ? 'bg-brand text-onbrand shadow-card' : 'text-muted hover:bg-sunken hover:text-ink')}><span aria-hidden className="w-5 text-center">{n.icon}</span>{n.label}</Link>)}
          </nav>
          <div className="border-t border-line pt-3"><div className="flex items-center justify-between gap-2 px-2"><div className="min-w-0"><div className="truncate text-sm font-bold">{me.name}</div><div className="text-xs capitalize text-muted">{me.role.replace('_', ' ')}</div></div>
            <ThemeToggle dark={theme.dark} onToggle={theme.toggle} /></div>
            <button onClick={logout} className="btn btn-ghost btn-sm mt-3 w-full">Sign out</button></div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
            <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-black text-onbrand">T</span><span className="font-extrabold">{brand}</span></div>
            <div className="flex items-center gap-2"><ThemeToggle dark={theme.dark} onToggle={theme.toggle} /><button onClick={logout} className="btn btn-ghost btn-sm">Sign out</button></div>
          </header>
          {me.sandbox && <div className="flex items-center justify-center gap-2 bg-warn/15 px-3 py-1.5 text-center text-xs font-bold text-warn ring-1 ring-inset ring-warn/30">🧪 SANDBOX ENVIRONMENT — all payments are simulated; no real money moves</div>}
          <main className="mx-auto max-w-6xl p-4 pb-28 sm:p-6 lg:pb-10">{children}</main>
        </div>
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 px-1 pt-1 backdrop-blur safe-b lg:hidden" aria-label="Main">
          {items.slice(0, 5).map((n) => <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cx('flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold', active(n.href) ? 'text-brandtext' : 'text-muted')}><span className="text-lg" aria-hidden>{n.icon}</span>{n.label}</Link>)}
          {items.length > 5 && <Link href={items[5].href} className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-muted"><span className="text-lg" aria-hidden>⋯</span>More</Link>}
        </nav>
      </div>
    </MeCtx.Provider>
  );
}

export function DashShell({ children }: { children: ReactNode }) {
  const me = useGuard('restaurant');
  const router = useRouter();
  useEffect(() => { if (me?.role === 'kitchen') router.replace('/kitchen'); }, [me, router]);
  if (!me || me.role === 'kitchen') return <div className="grid min-h-dvh place-items-center text-muted"><Spinner /></div>;
  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: '📊', perm: 'reports:read' }, { href: '/dashboard/orders', label: 'Orders', icon: '🧾', perm: 'orders:read' },
    { href: '/dashboard/menu', label: 'Menu', icon: '🍛', perm: 'menu:write' }, { href: '/dashboard/tables', label: 'Tables', icon: '▦', perm: 'orders:read' },
    { href: '/dashboard/payments', label: 'Payments', icon: '💳', perm: 'payments:read' }, { href: '/dashboard/feedback', label: 'Feedback', icon: '⭐', perm: 'feedback:read' },
    { href: '/dashboard/staff', label: 'Staff', icon: '👥', perm: 'staff:manage' }, { href: '/dashboard/settings', label: 'Settings', icon: '⚙️', perm: 'orders:read' },
    { href: '/dashboard/support', label: 'Support', icon: '💬', perm: 'support:write' }, { href: '/kitchen', label: 'Kitchen display', icon: '🔔', perm: 'orders:update' },
  ];
  return <Shell nav={nav} me={me} brand={me.restaurantName ?? 'Restaurant'}>{children}</Shell>;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const me = useGuard('platform');
  if (!me) return <div className="grid min-h-dvh place-items-center text-muted"><Spinner /></div>;
  const nav: NavItem[] = [
    { href: '/admin', label: 'Overview', icon: '🛰️' }, { href: '/admin/restaurants', label: 'Restaurants', icon: '🏪' }, { href: '/admin/transactions', label: 'Transactions', icon: '💸' },
    { href: '/admin/plans', label: 'Plans', icon: '🏷️', perm: 'platform:write' }, { href: '/admin/support', label: 'Support', icon: '💬' }, { href: '/admin/audit', label: 'Audit log', icon: '🔍' },
  ];
  return <Shell nav={nav} me={me} brand="Platform admin">{children}</Shell>;
}

export const PageHead = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl font-extrabold sm:text-3xl">{title}</h1>{sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}</div><div className="flex flex-wrap items-center gap-2">{actions}</div></div>
);
export { SandboxBadge };
