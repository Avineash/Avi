/**
 * Colour math used by the theme engine. Dependency-free, works in Node and browsers.
 * All public functions take and return normalised 6-digit lowercase hex strings ("#rrggbb").
 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number } // h: 0-360, s/l: 0-1

const HEX6 = /^#[0-9a-f]{6}$/;

/** Normalises "#abc", "ABCDEF", "#AABBCC" to "#aabbcc". Returns null when not a valid opaque hex colour. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let v = input.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return HEX6.test(v) ? v : null;
}

export function isHex(input: unknown): input is string {
  return typeof input === 'string' && HEX6.test(input);
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hexToHsl = (hex: string): HSL => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl: HSL): string =>
  rgbToHex(hslToRgb({ h: hsl.h, s: clamp(hsl.s, 0, 1), l: clamp(hsl.l, 0, 1) }));

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear sRGB interpolation: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/**
 * Picks whichever of `light` / `dark` has the higher contrast against `bg`. If neither reaches 4.5:1 (possible for
 * mid-tone backgrounds with soft near-black/near-white choices) it falls back to pure black or white, which always can.
 */
export function readableOn(bg: string, light = '#ffffff', dark = '#111111'): string {
  const best = contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
  if (contrastRatio(bg, best) >= 4.5) return best;
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#000000') ? '#ffffff' : '#000000';
}

/**
 * Returns `fg` unchanged if it already meets `min` against `bg`; otherwise nudges its lightness
 * (keeping hue and saturation) by the smallest amount that passes, in whichever direction needs less change.
 * Falls back to black/white if no lightness works.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const hsl = hexToHsl(fg);
  const search = (dir: 1 | -1): string | null => {
    for (let i = 1; i <= 100; i++) {
      const l = hsl.l + dir * i * 0.01;
      if (l < 0 || l > 1) return null;
      const cand = hslToHex({ ...hsl, l });
      if (contrastRatio(cand, bg) >= min) return cand;
    }
    return null;
  };
  const darker = search(-1), lighter = search(1);
  if (darker && lighter) {
    return Math.abs(hexToHsl(darker).l - hsl.l) <= Math.abs(hexToHsl(lighter).l - hsl.l) ? darker : lighter;
  }
  return darker ?? lighter ?? (contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff');
}

/** Ensures `fg` meets `min` against every background in `bgs`. */
export function ensureContrastAll(fg: string, bgs: string[], min: number): string {
  let out = fg;
  for (let pass = 0; pass < 3; pass++) {
    let ok = true;
    for (const bg of bgs) {
      if (contrastRatio(out, bg) < min) { out = ensureContrast(out, bg, min); ok = false; }
    }
    if (ok) return out;
  }
  return out;
}

/**
 * Hover/active shade for a filled control. Darkens light backgrounds, lightens dark ones,
 * and backs the amount off until `text` stays at least `minContrast` on the result.
 */
export function interactiveShade(bg: string, text: string, amount: number, minContrast = 4.5): string {
  const target = relativeLuminance(bg) > 0.2 ? '#000000' : '#ffffff';
  for (let t = amount; t > 0; t -= 0.02) {
    const out = mix(bg, target, t);
    if (contrastRatio(text, out) >= minContrast) return out;
  }
  return bg;
}

/** Blends `fg` toward `bg` while keeping `text` readable (used for subtle fills such as the active nav item). */
export function tintToward(bg: string, toward: string, amount: number, text: string, minContrast = 4.5): string {
  for (let t = amount; t > 0; t -= 0.02) {
    const out = mix(bg, toward, t);
    if (contrastRatio(text, out) >= minContrast) return out;
  }
  return bg;
}

// ---- perceptual distance (CIE76 ΔE in CIELAB, D65) ----

export function hexToLab(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a), [l2, a2, b2] = hexToLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}
