'use client';
import { useEffect, useState } from 'react';

const hexToRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Turns a restaurant's brand colours into accessible CSS variables (WCAG AA for text on the page background). */
export function brandVars(b: { primary?: string; secondary?: string } = {}, dark = false): Record<string, string> {
  const p = hexToRgb(b.primary ?? '#0F5C4D'), s = hexToRgb(b.secondary ?? '#E9A23B');
  const page = dark ? [13, 14, 16] : [250, 249, 246];
  const onBrand = contrast(p, [255, 255, 255]) >= contrast(p, [20, 20, 22]) ? [255, 255, 255] : [20, 20, 22];
  let text: number[] = p, i = 0;
  while (contrast(text, page) < 4.5 && i++ < 20) text = mix(text, dark ? [255, 255, 255] : [0, 0, 0], 0.12);
  const rgb = (c: number[]) => c.join(' ');
  return { '--brand': rgb(p), '--brand2': rgb(s), '--on-brand': rgb(onBrand), '--brand-text': rgb(text) };
}

export type ThemePref = 'light' | 'dark' | 'auto';
export function useTheme(defaultPref: ThemePref = 'auto') {
  const [pref, setPref] = useState<ThemePref>(defaultPref);
  const [dark, setDark] = useState(false);
  useEffect(() => { try { const s = localStorage.getItem('tf-theme') as ThemePref | null; if (s) setPref(s); } catch { /* storage blocked */ } }, []);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const d = pref === 'dark' || (pref === 'auto' && mq.matches); setDark(d); document.documentElement.dataset.theme = d ? 'dark' : 'light'; };
    apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [pref]);
  const set = (p: ThemePref) => { setPref(p); try { localStorage.setItem('tf-theme', p); } catch { /* ignore */ } };
  return { pref, dark, set, toggle: () => set(dark ? 'light' : 'dark') };
}
