import { hexToHsl, hslToHex, normalizeHex } from './color.ts';
import type { ColorSeeds } from './schema.ts';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Builds a complete light + dark seed palette from a single brand colour. This powers the "Custom brand"
 * preset: an administrator picks one colour and gets coherent neutrals, sidebar and accent in both schemes.
 * The brand colour itself is kept exactly as chosen in light mode.
 */
export function generatePalette(primaryInput: string): { light: ColorSeeds; dark: ColorSeeds } {
  const primary = normalizeHex(primaryInput) ?? '#1d4ed8';
  const { h, s, l } = hexToHsl(primary);
  const sat = clamp(s, 0.25, 0.85);
  const tint = Math.min(sat, 0.5);
  const accentHue = (h + 160) % 360;

  const light: ColorSeeds = {
    primary,
    secondary: hslToHex({ h, s: tint * 0.9, l: 0.92 }),
    accent: hslToHex({ h: accentHue, s: 0.62, l: 0.36 }),
    pageBg: hslToHex({ h, s: tint * 0.35, l: 0.965 }),
    surface: '#ffffff',
    text: hslToHex({ h, s: 0.22, l: 0.11 }),
    sidebarBg: hslToHex({ h, s: tint, l: 0.15 }),
    sidebarText: hslToHex({ h, s: 0.25, l: 0.95 }),
  };
  return { light, dark: generateDarkFromLight(light, l) };
}

/** Derives a dark-scheme seed set from a light one (used by "Generate dark palette"). */
export function generateDarkFromLight(light: ColorSeeds, primaryLightness?: number): ColorSeeds {
  const p = hexToHsl(light.primary ?? '#1d4ed8');
  const a = hexToHsl(light.accent ?? '#0e7490');
  const sat = clamp(p.s, 0.25, 0.85);
  const tint = Math.min(sat, 0.5);
  const lift = (hsl: { h: number; s: number; l: number }, min: number) =>
    hslToHex({ h: hsl.h, s: clamp(hsl.s, 0.3, 0.9), l: clamp(Math.max(hsl.l, min), min, 0.78) });
  void primaryLightness;
  return {
    primary: lift(p, 0.64),
    secondary: hslToHex({ h: p.h, s: tint * 0.45, l: 0.2 }),
    accent: lift(a, 0.62),
    pageBg: hslToHex({ h: p.h, s: tint * 0.4, l: 0.07 }),
    surface: hslToHex({ h: p.h, s: tint * 0.35, l: 0.115 }),
    text: hslToHex({ h: p.h, s: 0.15, l: 0.94 }),
    sidebarBg: hslToHex({ h: p.h, s: tint * 0.5, l: 0.045 }),
    sidebarText: hslToHex({ h: p.h, s: 0.15, l: 0.9 }),
  };
}
