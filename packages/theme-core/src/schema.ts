import { normalizeHex } from './color.ts';

// ─────────────────────────── vocabulary ───────────────────────────

export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

/** Seed colours every theme must define (in both schemes). Everything else is derived unless overridden. */
export const CORE_COLOR_KEYS = [
  'primary', 'secondary', 'accent', 'pageBg', 'surface', 'text', 'sidebarBg', 'sidebarText',
] as const;

/** Colours that are derived from the core set but may be overridden explicitly. */
export const OPTIONAL_COLOR_KEYS = [
  'mutedText', 'border', 'inputBorder', 'sidebarActive',
  'buttonBg', 'buttonText', 'buttonHoverBg', 'buttonActiveBg', 'focusRing',
] as const;

export const COLOR_KEYS = [...CORE_COLOR_KEYS, ...OPTIONAL_COLOR_KEYS] as const;
export type CoreColorKey = (typeof CORE_COLOR_KEYS)[number];
export type OptionalColorKey = (typeof OPTIONAL_COLOR_KEYS)[number];
export type ColorKey = (typeof COLOR_KEYS)[number];

export const STATUS_KEYS = ['approved', 'pending', 'rejected', 'cancelled'] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

/** Status text labels are fixed on purpose: colour is never the only indicator (WCAG 1.4.1). */
export const STATUS_LABELS: Record<StatusKey, string> = {
  approved: 'Approved', pending: 'Pending', rejected: 'Rejected', cancelled: 'Cancelled',
};

export const RADIUS_IDS = ['none', 'subtle', 'rounded', 'soft', 'pill'] as const;
export type RadiusId = (typeof RADIUS_IDS)[number];

export const DENSITY_IDS = ['compact', 'comfortable', 'spacious'] as const;
export type DensityId = (typeof DENSITY_IDS)[number];

export const MODE_IDS = ['light', 'dark', 'system'] as const;
export type ModeId = (typeof MODE_IDS)[number];

/** Groups an administrator can hand to (or withhold from) property-level administrators. */
export const CONFIG_GROUPS = ['identity', 'colors', 'status', 'typography', 'shape', 'mode'] as const;
export type ConfigGroup = (typeof CONFIG_GROUPS)[number];

export const GROUP_LABELS: Record<ConfigGroup, string> = {
  identity: 'Names, logo & favicon',
  colors: 'Brand & interface colors',
  status: 'Leave status colors',
  typography: 'Typography',
  shape: 'Corners & density',
  mode: 'Light / dark mode',
};

// ─────────────────────────── font library ───────────────────────────

export interface FontDef {
  id: string;
  label: string;
  category: 'system' | 'sans' | 'serif';
  /** CSS font-family stack. Only these approved stacks are ever emitted into CSS. */
  stack: string;
}

const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';

export const FONT_LIBRARY: readonly FontDef[] = [
  { id: 'system', label: 'System UI', category: 'system', stack: SANS_FALLBACK },
  { id: 'inter', label: 'Inter', category: 'sans', stack: `"Inter Variable", ${SANS_FALLBACK}` },
  { id: 'dm-sans', label: 'DM Sans', category: 'sans', stack: `"DM Sans Variable", ${SANS_FALLBACK}` },
  { id: 'source-sans-3', label: 'Source Sans 3', category: 'sans', stack: `"Source Sans 3 Variable", ${SANS_FALLBACK}` },
  { id: 'montserrat', label: 'Montserrat', category: 'sans', stack: `"Montserrat Variable", ${SANS_FALLBACK}` },
  { id: 'nunito-sans', label: 'Nunito Sans', category: 'sans', stack: `"Nunito Sans Variable", ${SANS_FALLBACK}` },
  { id: 'playfair-display', label: 'Playfair Display', category: 'serif', stack: `"Playfair Display Variable", ${SERIF_FALLBACK}` },
  { id: 'lora', label: 'Lora', category: 'serif', stack: `"Lora Variable", ${SERIF_FALLBACK}` },
  { id: 'cormorant', label: 'Cormorant', category: 'serif', stack: `"Cormorant Variable", ${SERIF_FALLBACK}` },
  { id: 'merriweather', label: 'Merriweather', category: 'serif', stack: `"Merriweather Variable", ${SERIF_FALLBACK}` },
];
export const FONT_IDS = FONT_LIBRARY.map((f) => f.id);
export const getFont = (id: string): FontDef => FONT_LIBRARY.find((f) => f.id === id) ?? FONT_LIBRARY[0]!;

// ─────────────────────────── config types ───────────────────────────

export type ColorSeeds = Partial<Record<ColorKey, string>>;
export interface StatusPair { bg?: string; fg?: string }
export type StatusScheme = Partial<Record<Scheme, StatusPair>>;

/**
 * A theme *layer*. Every field is optional: a layer only states what it changes, and layers are
 * merged system default → company → property. `null` means "explicitly none" (e.g. no logo).
 */
export interface ThemeConfig {
  identity?: {
    companyName?: string;
    propertyName?: string | null;
    tagline?: string | null;
    logoAssetId?: string | null;
    logoDarkAssetId?: string | null;
    faviconAssetId?: string | null;
  };
  colors?: Partial<Record<Scheme, ColorSeeds>>;
  status?: Partial<Record<StatusKey, StatusScheme>>;
  typography?: { headingFont?: string; bodyFont?: string };
  shape?: { radius?: RadiusId; density?: DensityId };
  mode?: { default?: ModeId; allowUserOverride?: boolean };
}

// ─────────────────────────── strict validation ───────────────────────────

export type ValidationResult =
  | { ok: true; config: ThemeConfig }
  | { ok: false; errors: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f<>]/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates and normalises an untrusted theme layer. Unknown keys are rejected (not ignored) so a typo
 * can never silently drop a setting, and nothing outside the approved vocabulary can reach generated CSS.
 */
export function validateThemeConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  const out: ThemeConfig = {};
  if (!isObj(input)) return { ok: false, errors: ['Theme must be an object.'] };

  const unknownKeys = (obj: Record<string, unknown>, allowed: readonly string[], where: string) => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`Unknown field "${where}${k}".`);
  };

  unknownKeys(input, CONFIG_GROUPS, '');

  // identity
  if (input.identity !== undefined) {
    const id = input.identity;
    if (!isObj(id)) errors.push('identity must be an object.');
    else {
      unknownKeys(id, ['companyName', 'propertyName', 'tagline', 'logoAssetId', 'logoDarkAssetId', 'faviconAssetId'], 'identity.');
      const o: NonNullable<ThemeConfig['identity']> = {};
      const text = (key: 'companyName' | 'propertyName' | 'tagline', max: number, nullable: boolean) => {
        const v = id[key];
        if (v === undefined) return;
        if (v === null) { if (nullable) o[key as 'propertyName' | 'tagline'] = null; else errors.push(`identity.${key} cannot be empty.`); return; }
        if (typeof v !== 'string') return void errors.push(`identity.${key} must be text.`);
        const t = v.trim();
        if (!t) { if (nullable) o[key as 'propertyName' | 'tagline'] = null; else errors.push(`identity.${key} cannot be empty.`); return; }
        if (t.length > max) return void errors.push(`identity.${key} must be at most ${max} characters.`);
        if (CONTROL_CHARS.test(t)) return void errors.push(`identity.${key} contains unsupported characters.`);
        o[key] = t;
      };
      text('companyName', 80, false);
      text('propertyName', 80, true);
      text('tagline', 120, true);
      for (const key of ['logoAssetId', 'logoDarkAssetId', 'faviconAssetId'] as const) {
        const v = id[key];
        if (v === undefined) continue;
        if (v === null) o[key] = null;
        else if (typeof v === 'string' && UUID.test(v)) o[key] = v;
        else errors.push(`identity.${key} must be an uploaded asset id.`);
      }
      out.identity = o;
    }
  }

  // colors
  if (input.colors !== undefined) {
    const c = input.colors;
    if (!isObj(c)) errors.push('colors must be an object.');
    else {
      unknownKeys(c, SCHEMES, 'colors.');
      const o: NonNullable<ThemeConfig['colors']> = {};
      for (const scheme of SCHEMES) {
        const s = c[scheme];
        if (s === undefined) continue;
        if (!isObj(s)) { errors.push(`colors.${scheme} must be an object.`); continue; }
        unknownKeys(s, COLOR_KEYS, `colors.${scheme}.`);
        const seeds: ColorSeeds = {};
        for (const key of COLOR_KEYS) {
          if (s[key] === undefined) continue;
          const hex = normalizeHex(s[key]);
          if (!hex) errors.push(`colors.${scheme}.${key} must be a hex colour such as #1a2b3c.`);
          else seeds[key] = hex;
        }
        o[scheme] = seeds;
      }
      out.colors = o;
    }
  }

  // status
  if (input.status !== undefined) {
    const st = input.status;
    if (!isObj(st)) errors.push('status must be an object.');
    else {
      unknownKeys(st, STATUS_KEYS, 'status.');
      const o: NonNullable<ThemeConfig['status']> = {};
      for (const key of STATUS_KEYS) {
        const entry = st[key];
        if (entry === undefined) continue;
        if (!isObj(entry)) { errors.push(`status.${key} must be an object.`); continue; }
        unknownKeys(entry, SCHEMES, `status.${key}.`);
        const so: StatusScheme = {};
        for (const scheme of SCHEMES) {
          const pair = entry[scheme];
          if (pair === undefined) continue;
          if (!isObj(pair)) { errors.push(`status.${key}.${scheme} must be an object.`); continue; }
          unknownKeys(pair, ['bg', 'fg'], `status.${key}.${scheme}.`);
          const p: StatusPair = {};
          for (const side of ['bg', 'fg'] as const) {
            if (pair[side] === undefined) continue;
            const hex = normalizeHex(pair[side]);
            if (!hex) errors.push(`status.${key}.${scheme}.${side} must be a hex colour such as #1a2b3c.`);
            else p[side] = hex;
          }
          so[scheme] = p;
        }
        o[key] = so;
      }
      out.status = o;
    }
  }

  // typography
  if (input.typography !== undefined) {
    const t = input.typography;
    if (!isObj(t)) errors.push('typography must be an object.');
    else {
      unknownKeys(t, ['headingFont', 'bodyFont'], 'typography.');
      const o: NonNullable<ThemeConfig['typography']> = {};
      for (const key of ['headingFont', 'bodyFont'] as const) {
        const v = t[key];
        if (v === undefined) continue;
        if (typeof v === 'string' && FONT_IDS.includes(v)) o[key] = v;
        else errors.push(`typography.${key} must be one of the approved fonts: ${FONT_IDS.join(', ')}.`);
      }
      out.typography = o;
    }
  }

  // shape
  if (input.shape !== undefined) {
    const s = input.shape;
    if (!isObj(s)) errors.push('shape must be an object.');
    else {
      unknownKeys(s, ['radius', 'density'], 'shape.');
      const o: NonNullable<ThemeConfig['shape']> = {};
      if (s.radius !== undefined) {
        if (typeof s.radius === 'string' && (RADIUS_IDS as readonly string[]).includes(s.radius)) o.radius = s.radius as RadiusId;
        else errors.push(`shape.radius must be one of: ${RADIUS_IDS.join(', ')}.`);
      }
      if (s.density !== undefined) {
        if (typeof s.density === 'string' && (DENSITY_IDS as readonly string[]).includes(s.density)) o.density = s.density as DensityId;
        else errors.push(`shape.density must be one of: ${DENSITY_IDS.join(', ')}.`);
      }
      out.shape = o;
    }
  }

  // mode
  if (input.mode !== undefined) {
    const m = input.mode;
    if (!isObj(m)) errors.push('mode must be an object.');
    else {
      unknownKeys(m, ['default', 'allowUserOverride'], 'mode.');
      const o: NonNullable<ThemeConfig['mode']> = {};
      if (m.default !== undefined) {
        if (typeof m.default === 'string' && (MODE_IDS as readonly string[]).includes(m.default)) o.default = m.default as ModeId;
        else errors.push(`mode.default must be one of: ${MODE_IDS.join(', ')}.`);
      }
      if (m.allowUserOverride !== undefined) {
        if (typeof m.allowUserOverride === 'boolean') o.allowUserOverride = m.allowUserOverride;
        else errors.push('mode.allowUserOverride must be true or false.');
      }
      out.mode = o;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, config: out };
}
