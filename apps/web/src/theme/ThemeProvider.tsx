import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveTheme, themeToCss, type ModeId, type ResolvedTheme, type ThemeConfig } from '@staffhub/theme-core';
import { resolveMode, SchemeContext, useSystemDark } from '@staffhub/ui';
import { assetUrl } from '../api.ts';

const MODE_KEY = 'sh:mode';
const THEME_KEY = 'sh:theme:v1';

const safe = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable (private mode): fine, cache only */ } },
};

/** Last published theme seen in this browser — used only to avoid a flash before the server answers. The server stays the source of truth. */
export function readCachedTheme(): ThemeConfig | undefined {
  const raw = safe.get(THEME_KEY);
  if (!raw) return undefined;
  try { return (JSON.parse(raw) as { config: ThemeConfig }).config; } catch { return undefined; }
}
export const cacheTheme = (config: ThemeConfig, fingerprint: string) => safe.set(THEME_KEY, JSON.stringify({ config, fingerprint }));

interface Appearance {
  theme: ResolvedTheme;
  /** Mode in effect: the user's choice when the brand allows it, otherwise the brand default. */
  mode: ModeId;
  scheme: 'light' | 'dark';
  userPref: ModeId | null;
  canOverride: boolean;
  setUserPref: (m: ModeId | null) => void;
}
const Ctx = createContext<Appearance | null>(null);
export const useAppearance = () => { const c = useContext(Ctx); if (!c) throw new Error('useAppearance outside ThemeProvider'); return c; };

const monogramFavicon = (color: string, text: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="700" fill="#fff">${text}</text></svg>`)}`;

/**
 * Applies the *published* theme to the whole document: CSS variables on :root, the light/dark/system switch,
 * favicon, browser theme colour and page title. Everything visual downstream reads tokens, nothing reads this config.
 */
export function ThemeProvider({ config, appearancePref, onPersistPref, children }: {
  config: ThemeConfig | undefined; appearancePref?: ModeId | null; onPersistPref?: (m: ModeId | null) => void; children: ReactNode;
}) {
  const theme = useMemo(() => resolveTheme(config), [config]);
  const css = useMemo(() => themeToCss(theme), [theme]);
  const systemDark = useSystemDark();
  const [userPref, setPref] = useState<ModeId | null>(() => (safe.get(MODE_KEY) as ModeId | null) ?? null);

  // The server-stored preference (follows the user across devices) wins once known.
  useEffect(() => { if (appearancePref !== undefined && appearancePref !== userPref) { setPref(appearancePref); safe.set(MODE_KEY, appearancePref ?? ''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [appearancePref]);

  const canOverride = theme.mode.allowUserOverride;
  const mode: ModeId = canOverride && userPref ? userPref : theme.mode.default;
  const scheme = resolveMode(mode, systemDark);

  const setUserPref = useCallback((m: ModeId | null) => { setPref(m); safe.set(MODE_KEY, m ?? ''); onPersistPref?.(m); }, [onPersistPref]);

  useLayoutEffect(() => { document.documentElement.dataset.scheme = mode; }, [mode]);
  useEffect(() => {
    const s = theme.schemes[scheme];
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', s.colors.pageBg);
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const href = assetUrl(theme.identity.faviconAssetId) ?? monogramFavicon(theme.schemes.light.colors.primary, (theme.identity.displayName[0] ?? 'S').toUpperCase());
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
    document.title = `${theme.identity.displayName} · StaffHub`;
  }, [theme, scheme]);

  const value = useMemo<Appearance>(() => ({ theme, mode, scheme, userPref, canOverride, setUserPref }), [theme, mode, scheme, userPref, canOverride, setUserPref]);
  return (
    <Ctx.Provider value={value}>
      <style data-ds-theme>{css}</style>
      <SchemeContext.Provider value={scheme}>{children}</SchemeContext.Provider>
    </Ctx.Provider>
  );
}
