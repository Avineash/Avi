import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { ModeId, ThemeConfig } from '@staffhub/theme-core';
import { Button, Icon, type IconName } from '@staffhub/ui';
import { api } from './api.ts';
import { AppFrame, type FrameNavItem } from './AppFrame.tsx';
import { AuthProvider, useAuth } from './auth.tsx';
import { AuditPage } from './audit/AuditPage.tsx';
import { BrandAppearance } from './brand/BrandAppearance.tsx';
import { ROLE_LABEL } from './format.ts';
import type { PublishedTheme } from './types.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { LeavePage } from './pages/Leave.tsx';
import { Login } from './pages/Login.tsx';
import { NotificationsPage } from './pages/Notifications.tsx';
import { RosterPage } from './pages/Roster.tsx';
import { cacheTheme, readCachedTheme, ThemeProvider, useAppearance } from './theme/ThemeProvider.tsx';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/leave': 'Leave', '/roster': 'Roster', '/notifications': 'Notifications', '/audit': 'Night audit', '/brand': 'Brand & Appearance' };

function ModeToggle() {
  const { mode, setUserPref, canOverride } = useAppearance();
  if (!canOverride) return null;
  const opts: Array<[ModeId, IconName, string]> = [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'monitor', 'System']];
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Appearance">
      {opts.map(([m, icon, label]) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} aria-label={label} title={label} className={mode === m ? 'is-on' : ''} onClick={() => setUserPref(m)}><Icon name={icon} size={16} /></button>
      ))}
    </div>
  );
}

function Layout() {
  const { me, logout } = useAuth();
  const { theme } = useAppearance();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);
  useEffect(() => { api.get<{ notifications: Array<{ read: boolean }> }>('/api/notifications').then((r) => setUnread(r.notifications.filter((n) => !n.read).length)).catch(() => {}); }, [pathname]);
  if (!me) return null;

  const items: FrameNavItem[] = [
    { id: '/', label: 'Dashboard', icon: 'home', href: '/' },
    { id: '/leave', label: 'Leave', icon: 'calendar', href: '/leave' },
    { id: '/roster', label: 'Roster', icon: 'roster', href: '/roster' },
    { id: '/notifications', label: 'Alerts', icon: 'bell', href: '/notifications', badge: unread ? <span className="nav-badge" aria-label={`${unread} unread`}>{unread}</span> : undefined },
    ...(me.permissions.nightAudit ? [{ id: '/audit', label: 'Audit', icon: 'moon' as const, href: '/audit' }] : []),
    ...(me.permissions.manageBrand ? [{ id: '/brand', label: 'Brand', icon: 'palette' as const, href: '/brand' }] : []),
  ];
  const title = TITLES[pathname] ?? 'StaffHub';
  return (
    <div className="ds-root app-root">
      <AppFrame theme={theme} nav={items} activeId={pathname} onNavigate={nav} userName={me.user.name} userRole={ROLE_LABEL[me.user.role]} title={title}
        actions={<><ModeToggle /><Button variant="ghost" size="sm" icon="logout" onClick={async () => { await logout(); nav('/login'); }}>Sign out</Button></>}>
        <Outlet />
      </AppFrame>
    </div>
  );
}

function Gate() {
  const { me, loading } = useAuth();
  if (loading) return <div className="ds-root app-root boot" role="status">Loading…</div>;
  return me ? <Layout /> : <Navigate to="/login" replace />;
}

function Routed({ onBrand }: { onBrand: (c: ThemeConfig | undefined) => void }) {
  const { me } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login onBrand={onBrand} />} />
      <Route element={<Gate />}>
        <Route index element={<Dashboard />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="roster" element={<RosterPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="audit" element={me?.permissions.nightAudit ? <AuditPage /> : <Navigate to="/" replace />} />
        <Route path="brand" element={me?.permissions.manageBrand ? <BrandAppearance /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Chooses which theme is on screen: the signed-in user's published theme, else the sign-in page's company brand, else the last one seen here. */
function Themed() {
  const { me, reload } = useAuth();
  const [publicBrand, setPublicBrand] = useState<ThemeConfig | undefined>();
  const [cached] = useState(readCachedTheme);
  const onBrand = useCallback((c: ThemeConfig | undefined) => setPublicBrand(c), []);
  useEffect(() => { if (me) cacheTheme(me.theme.config, me.theme.fingerprint); }, [me]);
  // A publish made on another device shows up as soon as this tab regains focus (cheap: ETag revalidation).
  const fp = me?.theme.fingerprint;
  useEffect(() => {
    if (!fp) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      api.get<PublishedTheme>('/api/theme').then((t) => { if (t.fingerprint !== fp) void reload(); }).catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [fp, reload]);
  const config = me ? me.theme.config : publicBrand ?? cached;
  const persist = useCallback((m: ModeId | null) => { if (me) void api.patch('/api/me/preferences', { appearance: m }); }, [me]);
  return (
    <ThemeProvider config={config} appearancePref={me ? me.user.appearancePref : undefined} onPersistPref={persist}>
      <Routed onBrand={onBrand} />
    </ThemeProvider>
  );
}

export function App() {
  return <BrowserRouter><AuthProvider><Themed /></AuthProvider></BrowserRouter>;
}
