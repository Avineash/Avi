import { createContext, useContext, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { themeToCss, type ModeId, type ResolvedTheme } from '@staffhub/theme-core';

/** The scheme actually being painted ("system" already resolved). Lets components pick e.g. the dark-mode logo. */
export const SchemeContext = createContext<'light' | 'dark'>('light');
export const useScheme = () => useContext(SchemeContext);

export function useSystemDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

export const resolveMode = (mode: ModeId, systemDark: boolean): 'light' | 'dark' => (mode === 'system' ? (systemDark ? 'dark' : 'light') : mode);

/**
 * Applies a theme to a subtree only. Used for live previews, preset thumbnails and anywhere two themes must
 * coexist on one page. The theme's CSS is generated against a unique attribute selector, so nothing leaks out
 * and the published (app-level) theme is untouched.
 */
export function ThemeScope({ theme, mode = 'light', className = '', style, children }: {
  theme: ResolvedTheme; mode?: ModeId; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  const id = useId();
  const systemDark = useSystemDark();
  const css = useMemo(() => themeToCss(theme, { selector: `[data-ds-scope="${id}"]` }), [theme, id]);
  return (
    <SchemeContext.Provider value={resolveMode(mode, systemDark)}>
      <style>{css}</style>
      <div data-ds-scope={id} data-scheme={mode} className={`ds-root ${className}`} style={style}>{children}</div>
    </SchemeContext.Provider>
  );
}
