import {
  contrastRatio, ensureContrast, ensureContrastAll, hexToHsl, hslToHex, interactiveShade, mix, readableOn, tintToward,
} from './color.ts';
import { mergeConfigs } from './config-ops.ts';
import type {
  ColorKey, DensityId, ModeId, RadiusId, Scheme, StatusKey, ThemeConfig,
} from './schema.ts';
import { COLOR_KEYS, getFont, SCHEMES, STATUS_KEYS } from './schema.ts';
import { SYSTEM_DEFAULT_THEME } from './presets.ts';

export interface StatusColors { bg: string; fg: string; border: string }

export interface ResolvedScheme {
  /** Every editable colour, resolved (explicit value, or the derived default). */
  colors: Record<ColorKey, string>;
  /** Brand colour guaranteed ≥ 4.5:1 on page and card backgrounds, for links and text-coloured accents. */
  primaryText: string;
  onSecondary: string;
  onAccent: string;
  status: Record<StatusKey, StatusColors>;
  info: StatusColors;
  /** Six categorical chart colours, each ≥ 3:1 on the card surface. */
  charts: string[];
  shadow: string;
  overlay: string;
}

export interface ResolvedTheme {
  identity: {
    companyName: string;
    propertyName: string | null;
    tagline: string | null;
    /** companyName, or propertyName when the property has its own display name. */
    displayName: string;
    logoAssetId: string | null;
    logoDarkAssetId: string | null;
    faviconAssetId: string | null;
  };
  schemes: Record<Scheme, ResolvedScheme>;
  typography: { headingFont: string; bodyFont: string; headingStack: string; bodyStack: string };
  shape: { radius: RadiusId; density: DensityId };
  mode: { default: ModeId; allowUserOverride: boolean };
  /** The fully merged layer stack this theme was resolved from (system default included). */
  config: ThemeConfig;
}

export const RADIUS_TOKENS: Record<RadiusId, { sm: number; md: number; lg: number; btn: number }> = {
  none: { sm: 0, md: 0, lg: 0, btn: 0 },
  subtle: { sm: 2, md: 4, lg: 6, btn: 4 },
  rounded: { sm: 4, md: 8, lg: 12, btn: 8 },
  soft: { sm: 8, md: 14, lg: 20, btn: 12 },
  pill: { sm: 8, md: 14, lg: 22, btn: 999 },
};

export const DENSITY_TOKENS: Record<DensityId, { unit: number; control: number; row: number; font: number }> = {
  compact: { unit: 3.5, control: 32, row: 38, font: 13.5 },
  comfortable: { unit: 4, control: 40, row: 48, font: 14.5 },
  spacious: { unit: 4.75, control: 46, row: 58, font: 15.5 },
};

/** Merge the system default with company / property layers (in that order) and derive every token. */
export function resolveTheme(...layers: Array<ThemeConfig | null | undefined>): ResolvedTheme {
  const config = mergeConfigs(SYSTEM_DEFAULT_THEME, ...layers);
  const schemes = {} as Record<Scheme, ResolvedScheme>;
  for (const scheme of SCHEMES) schemes[scheme] = resolveScheme(config, scheme);

  const id = config.identity ?? {};
  const companyName = id.companyName ?? 'Your Company';
  const propertyName = id.propertyName ?? null;
  const t = config.typography ?? {};

  return {
    identity: {
      companyName,
      propertyName,
      tagline: id.tagline ?? null,
      displayName: propertyName ?? companyName,
      logoAssetId: id.logoAssetId ?? null,
      logoDarkAssetId: id.logoDarkAssetId ?? null,
      faviconAssetId: id.faviconAssetId ?? null,
    },
    schemes,
    typography: {
      headingFont: getFont(t.headingFont ?? 'inter').id,
      bodyFont: getFont(t.bodyFont ?? 'inter').id,
      headingStack: getFont(t.headingFont ?? 'inter').stack,
      bodyStack: getFont(t.bodyFont ?? 'inter').stack,
    },
    shape: { radius: config.shape?.radius ?? 'rounded', density: config.shape?.density ?? 'comfortable' },
    mode: { default: config.mode?.default ?? 'system', allowUserOverride: config.mode?.allowUserOverride ?? true },
    config,
  };
}

function resolveScheme(config: ThemeConfig, scheme: Scheme): ResolvedScheme {
  const s = config.colors?.[scheme] ?? {};
  const dark = scheme === 'dark';

  const primary = s.primary!, secondary = s.secondary!, accent = s.accent!;
  const pageBg = s.pageBg!, surface = s.surface!, text = s.text!;
  const sidebarBg = s.sidebarBg!, sidebarText = s.sidebarText!;

  const mutedText = s.mutedText ?? ensureContrastAll(mix(text, surface, 0.36), [surface, pageBg], 4.5);
  const border = s.border ?? mix(text, surface, 0.86);
  const inputBorder = s.inputBorder ?? ensureContrastAll(mix(text, surface, 0.5), [surface, pageBg], 3);
  const sidebarActive = s.sidebarActive ?? tintToward(sidebarBg, sidebarText, 0.16, sidebarText);

  const buttonBg = s.buttonBg ?? primary;
  const buttonText = s.buttonText ?? readableOn(buttonBg);
  const buttonHoverBg = s.buttonHoverBg ?? interactiveShade(buttonBg, buttonText, 0.12);
  const buttonActiveBg = s.buttonActiveBg ?? interactiveShade(buttonBg, buttonText, 0.22);
  const focusRing = s.focusRing ?? ensureContrastAll(primary, [surface, pageBg], 3);

  const colors = {
    primary, secondary, accent, pageBg, surface, text, sidebarBg, sidebarText,
    mutedText, border, inputBorder, sidebarActive,
    buttonBg, buttonText, buttonHoverBg, buttonActiveBg, focusRing,
  } satisfies Record<ColorKey, string>;
  // keep COLOR_KEYS and the object in lock-step if a key is ever added
  for (const k of COLOR_KEYS) if (!colors[k]) throw new Error(`theme: colour "${k}" did not resolve (${scheme})`);

  const status = {} as Record<StatusKey, StatusColors>;
  for (const key of STATUS_KEYS) {
    const pair = config.status?.[key]?.[scheme] ?? {};
    const bg = pair.bg!, fg = pair.fg!;
    status[key] = { bg, fg, border: mix(fg, bg, 0.45) };
  }

  // "Info" is deliberately neutral (tinted from text/surface, not from the brand colour): a brand-coloured notice could
  // look identical to a Rejected or Pending status, and statuses must stay unambiguous whatever the palette.
  const infoBg = mix(text, surface, dark ? 0.9 : 0.94);
  const infoFg = ensureContrast(text, infoBg, 4.5);

  return {
    colors,
    primaryText: ensureContrastAll(primary, [surface, pageBg], 4.5),
    onSecondary: readableOn(secondary),
    onAccent: readableOn(accent),
    status,
    info: { bg: infoBg, fg: infoFg, border: mix(infoFg, infoBg, 0.45) },
    charts: deriveChartColors(primary, accent, surface),
    shadow: dark ? '0 1px 2px rgb(0 0 0 / 0.5), 0 2px 8px rgb(0 0 0 / 0.35)' : '0 1px 2px rgb(16 24 40 / 0.06), 0 2px 8px rgb(16 24 40 / 0.08)',
    overlay: dark ? 'rgb(0 0 0 / 0.65)' : 'rgb(16 24 40 / 0.45)',
  };
}

/**
 * Six categorical colours. Slot 1 is the brand colour, slot 2 the accent; the rest rotate around the brand hue.
 * Each is pushed (minimally) to ≥ 3:1 on the card surface so charts satisfy WCAG 1.4.11 without admin effort.
 * Near-greyscale brands fall back to a lightness ramp, since hue rotation would produce identical greys.
 */
export function deriveChartColors(primary: string, accent: string, surface: string): string[] {
  const p = hexToHsl(primary);
  let raw: string[];
  if (p.s < 0.12) {
    raw = [primary, accent, '#4b5563', '#6b7280', '#374151', '#9ca3af'];
  } else {
    const s = Math.min(0.7, Math.max(0.45, p.s));
    const rot = (deg: number, l: number) => hslToHex({ h: p.h + deg, s, l });
    raw = [primary, accent, rot(120, 0.45), rot(200, 0.5), rot(280, 0.5), rot(45, 0.48)];
  }
  return raw.map((c) => ensureContrast(c, surface, 3));
}

/** Convenience: contrast ratio of two resolved colours, rounded the way WCAG reports it. */
export const ratio = (a: string, b: string): number => Math.round(contrastRatio(a, b) * 100) / 100;

// ───────────── stable fingerprint (ETag / cache-busting) ─────────────

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** cyrb53 – small, fast, good-enough non-cryptographic hash of a config. */
export function fingerprint(config: unknown): string {
  const str = stableStringify(config);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
