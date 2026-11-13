import type { ReactNode } from 'react';
import type { ResolvedTheme } from '@staffhub/theme-core';
import { AppShell, Avatar, BrandLogo, NavItem, type IconName } from '@staffhub/ui';
import { assetUrl } from './api.ts';

export interface FrameNavItem { id: string; label: string; icon: IconName; href: string; badge?: ReactNode }

/**
 * The application chrome: branded sidebar (desktop) / bottom bar (phone), top bar and content area.
 * Used verbatim by the real app *and* by the live preview, which is why the preview can be trusted.
 */
export function AppFrame({ theme, nav, activeId, onNavigate, userName, userRole, title, actions, children }: {
  theme: ResolvedTheme; nav: FrameNavItem[]; activeId: string; onNavigate?: (href: string) => void;
  userName: string; userRole: string; title: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const id = theme.identity;
  const caption = id.propertyName && id.propertyName !== id.companyName ? id.propertyName : id.tagline;
  const logo = <BrandLogo name={id.displayName} logoUrl={assetUrl(id.logoAssetId)} logoDarkUrl={assetUrl(id.logoDarkAssetId)} height={34} />;
  return (
    <AppShell
      brand={<div className="brand-block">{logo}{caption && <div className="brand-caption">{caption}</div>}</div>}
      nav={nav.map((n) => <NavItem key={n.id} icon={n.icon} label={n.label} href={n.href} active={n.id === activeId} onNavigate={onNavigate} badge={n.badge} />)}
      navFooter={<div className="user-chip"><Avatar name={userName} size={34} /><div><div className="user-chip__name">{userName}</div><div className="user-chip__role">{userRole}</div></div></div>}
      title={title}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}
