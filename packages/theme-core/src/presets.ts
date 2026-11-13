import { generatePalette } from './palette.ts';
import { mergeConfigs } from './config-ops.ts';
import type { ConfigGroup, StatusKey, StatusScheme, ThemeConfig } from './schema.ts';

/** Starting brand colour offered by the "Custom brand" preset. */
export const CUSTOM_BRAND_DEFAULT = '#6d28d9';

export type PresetId =
  | 'premium-hospitality' | 'modern-corporate' | 'minimal-monochrome'
  | 'boutique-hotel' | 'luxury-dark' | 'custom-brand';

export interface ThemePreset {
  id: PresetId;
  name: string;
  description: string;
  /** Groups the preset sets. Applying a preset never touches names, logos or status colors. */
  config: ThemeConfig;
  /** True for the generator preset, which asks for a brand colour. */
  generated?: boolean;
}

/**
 * Leave-status defaults. Deliberately independent of the brand palette: green / amber / red / grey
 * keep their conventional meaning whatever the brand looks like. Every pair is ≥ 7:1.
 */
export const DEFAULT_STATUS_COLORS: Record<StatusKey, StatusScheme> = {
  approved:  { light: { bg: '#dff5e6', fg: '#14532d' }, dark: { bg: '#12351f', fg: '#a8f0c0' } },
  pending:   { light: { bg: '#fef0c7', fg: '#7a3e06' }, dark: { bg: '#44310a', fg: '#fcd679' } },
  rejected:  { light: { bg: '#fde4e1', fg: '#8a1c13' }, dark: { bg: '#4a1a17', fg: '#fdc4be' } },
  cancelled: { light: { bg: '#e8eaee', fg: '#3d4553' }, dark: { bg: '#2a2f38', fg: '#c8cdd6' } },
};

// NOTE: the palettes below are original example themes. They imitate no real company's brand
// and make no claim of official brand compliance.
const modernCorporate: ThemePreset = {
  id: 'modern-corporate',
  name: 'Modern corporate',
  description: 'Clean blue and slate with crisp corners. Efficient, familiar, easy to read.',
  config: {
    colors: {
      light: { primary: '#1d4ed8', secondary: '#e3e9fb', accent: '#0e7490', pageBg: '#f3f5f9', surface: '#ffffff', text: '#101828', sidebarBg: '#0f172a', sidebarText: '#e2e8f0' },
      dark: { primary: '#7aa2ff', secondary: '#1c2a4d', accent: '#4cc3dd', pageBg: '#0b1020', surface: '#121a2e', text: '#e8ecf5', sidebarBg: '#070b16', sidebarText: '#d5dbe8' },
    },
    typography: { headingFont: 'inter', bodyFont: 'inter' },
    shape: { radius: 'subtle', density: 'comfortable' },
    mode: { default: 'system', allowUserOverride: true },
  },
};

export const PRESETS: readonly ThemePreset[] = [
  {
    id: 'premium-hospitality',
    name: 'Premium hospitality',
    description: 'Deep teal with brass accents, warm paper background and an editorial serif heading.',
    config: {
      colors: {
        light: { primary: '#0f5c5a', secondary: '#e3eeea', accent: '#b07d2b', pageBg: '#f6f3ee', surface: '#ffffff', text: '#1d2a2b', sidebarBg: '#0c2f33', sidebarText: '#f1ece2' },
        dark: { primary: '#5fc4bd', secondary: '#17332f', accent: '#d9a94f', pageBg: '#0c1516', surface: '#121e20', text: '#eef2ef', sidebarBg: '#08181a', sidebarText: '#e6e9e2' },
      },
      typography: { headingFont: 'playfair-display', bodyFont: 'source-sans-3' },
      shape: { radius: 'rounded', density: 'comfortable' },
      mode: { default: 'light', allowUserOverride: true },
    },
  },
  modernCorporate,
  {
    id: 'minimal-monochrome',
    name: 'Minimal monochrome',
    description: 'Black, white and grey. Square corners, generous space, no decoration.',
    config: {
      colors: {
        light: { primary: '#111111', secondary: '#ececec', accent: '#444444', pageBg: '#f7f7f7', surface: '#ffffff', text: '#111111', sidebarBg: '#ffffff', sidebarText: '#1a1a1a' },
        dark: { primary: '#f2f2f2', secondary: '#2a2a2a', accent: '#bdbdbd', pageBg: '#0d0d0d', surface: '#161616', text: '#f2f2f2', sidebarBg: '#0a0a0a', sidebarText: '#e8e8e8' },
      },
      typography: { headingFont: 'dm-sans', bodyFont: 'dm-sans' },
      shape: { radius: 'none', density: 'spacious' },
      mode: { default: 'system', allowUserOverride: true },
    },
  },
  {
    id: 'boutique-hotel',
    name: 'Boutique hotel',
    description: 'Dusty rose and plum with sage highlights, soft corners and a light display serif.',
    config: {
      colors: {
        light: { primary: '#9b3d55', secondary: '#f5e6e8', accent: '#5d7f69', pageBg: '#fbf6f3', surface: '#ffffff', text: '#2b1d22', sidebarBg: '#3a1f2b', sidebarText: '#f7ece9' },
        dark: { primary: '#e58aa2', secondary: '#3a2029', accent: '#8dc3a0', pageBg: '#161013', surface: '#1f171b', text: '#f6ecee', sidebarBg: '#100a0d', sidebarText: '#f0e3e5' },
      },
      typography: { headingFont: 'cormorant', bodyFont: 'nunito-sans' },
      shape: { radius: 'soft', density: 'spacious' },
      mode: { default: 'light', allowUserOverride: true },
    },
  },
  {
    id: 'luxury-dark',
    name: 'Luxury dark',
    description: 'Near-black canvas with antique gold. Opens in dark mode; the light scheme is a warm parchment.',
    config: {
      colors: {
        dark: { primary: '#c9a35b', secondary: '#2a2418', accent: '#e5c98b', pageBg: '#0b0b0d', surface: '#151518', text: '#f2ede4', sidebarBg: '#000000', sidebarText: '#e8e0d0' },
        light: { primary: '#7a5a1e', secondary: '#f1e9d8', accent: '#8a6a2c', pageBg: '#f4f1ea', surface: '#ffffff', text: '#1c1a16', sidebarBg: '#111111', sidebarText: '#efe6d2' },
      },
      typography: { headingFont: 'playfair-display', bodyFont: 'montserrat' },
      shape: { radius: 'subtle', density: 'comfortable' },
      mode: { default: 'dark', allowUserOverride: true },
    },
  },
  {
    id: 'custom-brand',
    name: 'Custom brand',
    description: 'Start from one brand colour and generate a complete light and dark palette.',
    generated: true,
    config: {
      colors: generatePalette(CUSTOM_BRAND_DEFAULT),
      typography: { headingFont: 'inter', bodyFont: 'inter' },
      shape: { radius: 'rounded', density: 'comfortable' },
      mode: { default: 'system', allowUserOverride: true },
    },
  },
];

export const getPreset = (id: string): ThemePreset | undefined => PRESETS.find((p) => p.id === id);

/** The theme every company starts from. Neutral on purpose: it belongs to the platform, not to any tenant. */
export const SYSTEM_DEFAULT_THEME: ThemeConfig = mergeConfigs(
  { identity: { companyName: 'Your Company' }, status: DEFAULT_STATUS_COLORS },
  modernCorporate.config,
);

/** Builds the "Custom brand" config for a chosen brand colour. */
export function customBrandConfig(primary: string): ThemeConfig {
  const base = getPreset('custom-brand')!.config;
  return { ...base, colors: generatePalette(primary) };
}

/**
 * Applies a preset onto a layer, replacing only the groups both the preset defines and `allowed` permits.
 * Identity and status are never touched by presets.
 */
export function applyPreset(
  layer: ThemeConfig,
  preset: ThemePreset,
  allowed: Partial<Record<ConfigGroup, boolean>> = {},
): ThemeConfig {
  const out: ThemeConfig = { ...layer };
  for (const group of ['colors', 'typography', 'shape', 'mode'] as const) {
    if (allowed[group] === false) continue;
    const v = preset.config[group];
    if (v) (out as Record<string, unknown>)[group] = structuredClone(v);
  }
  return out;
}
