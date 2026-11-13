import type { ResolvedTheme } from './resolve.ts';
import { DENSITY_TOKENS, RADIUS_TOKENS } from './resolve.ts';
import type { Scheme } from './schema.ts';
import { STATUS_KEYS } from './schema.ts';

export type TokenMap = Record<string, string>;

/** Colour tokens for one scheme. */
export function schemeTokens(theme: ResolvedTheme, scheme: Scheme): TokenMap {
  const s = theme.schemes[scheme];
  const c = s.colors;
  const t: TokenMap = {
    '--ds-bg': c.pageBg,
    '--ds-surface': c.surface,
    '--ds-text': c.text,
    '--ds-text-muted': c.mutedText,
    '--ds-border': c.border,
    '--ds-border-input': c.inputBorder,
    '--ds-primary': c.primary,
    '--ds-primary-text': s.primaryText,
    '--ds-secondary': c.secondary,
    '--ds-on-secondary': s.onSecondary,
    '--ds-accent': c.accent,
    '--ds-on-accent': s.onAccent,
    '--ds-btn-bg': c.buttonBg,
    '--ds-btn-fg': c.buttonText,
    '--ds-btn-bg-hover': c.buttonHoverBg,
    '--ds-btn-bg-active': c.buttonActiveBg,
    '--ds-focus': c.focusRing,
    '--ds-nav-bg': c.sidebarBg,
    '--ds-nav-fg': c.sidebarText,
    '--ds-nav-active-bg': c.sidebarActive,
    '--ds-info-bg': s.info.bg,
    '--ds-info-fg': s.info.fg,
    '--ds-info-border': s.info.border,
    '--ds-shadow': s.shadow,
    '--ds-overlay': s.overlay,
  };
  for (const k of STATUS_KEYS) {
    t[`--ds-status-${k}-bg`] = s.status[k].bg;
    t[`--ds-status-${k}-fg`] = s.status[k].fg;
    t[`--ds-status-${k}-border`] = s.status[k].border;
  }
  s.charts.forEach((color, i) => { t[`--ds-chart-${i + 1}`] = color; });
  return t;
}

/** Scheme-independent tokens: typography, corner radius, density. */
export function commonTokens(theme: ResolvedTheme): TokenMap {
  const r = RADIUS_TOKENS[theme.shape.radius];
  const d = DENSITY_TOKENS[theme.shape.density];
  return {
    '--ds-font-body': theme.typography.bodyStack,
    '--ds-font-heading': theme.typography.headingStack,
    '--ds-radius-sm': `${r.sm}px`,
    '--ds-radius-md': `${r.md}px`,
    '--ds-radius-lg': `${r.lg}px`,
    '--ds-radius-btn': `${r.btn}px`,
    '--ds-space': `${d.unit}px`,
    '--ds-control-h': `${d.control}px`,
    '--ds-row-h': `${d.row}px`,
    '--ds-font-size': `${d.font}px`,
  };
}

const decl = (tokens: TokenMap, scheme: Scheme) =>
  `${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')};color-scheme:${scheme}`;

/**
 * Generates the stylesheet for a theme.
 *
 *   <selector>                        light tokens + typography/shape/density
 *   <selector>[data-scheme="dark"]    dark tokens
 *   <selector>[data-scheme="system"]  light tokens, dark under prefers-color-scheme
 *
 * Use `:root` for the app and an attribute selector for isolated previews. Every value is drawn from validated
 * hex colours and approved enums/font stacks, never from free text, so the output is safe to inject.
 */
export function themeToCss(theme: ResolvedTheme, opts: { selector?: string } = {}): string {
  const sel = opts.selector ?? ':root';
  const light = { ...commonTokens(theme), ...schemeTokens(theme, 'light') };
  const dark = schemeTokens(theme, 'dark');
  return [
    `${sel}{${decl(light, 'light')}}`,
    `${sel}[data-scheme="dark"]{${decl(dark, 'dark')}}`,
    `@media (prefers-color-scheme:dark){${sel}[data-scheme="system"]{${decl(dark, 'dark')}}}`,
  ].join('\n');
}
