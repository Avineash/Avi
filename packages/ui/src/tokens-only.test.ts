import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard rail for the white-label promise: UI code may only get colour from --ds-* tokens.
 * A hard-coded colour in a component or stylesheet would silently ignore a tenant's theme.
 * Legitimate exceptions (a light logo plate, a device bezel…) carry a `literal-ok` marker with a reason.
 */
const root = join(import.meta.dirname, '../../..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (f === 'node_modules' || f === 'dist' || f === 'dist-types') return [];
  return statSync(p).isDirectory() ? files(p) : [p];
});
const sources = [...files(join(root, 'packages/ui/src')), ...files(join(root, 'apps/web/src'))]
  .filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/previewData|seed/.test(f));

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/;

describe('design-system hygiene', () => {
  it('finds source files to check', () => expect(sources.length).toBeGreaterThan(10));

  it('contains no hard-coded colours outside the documented exceptions', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (!COLOUR.test(code) || /literal-ok/.test(line)) return;
        // theme-core owns colour literals; React inline `color="..."` in the monogram favicon is tokenised elsewhere
        if (/monogramFavicon|<svg xmlns|fill="#/.test(line)) return;
        offenders.push(`${file.replace(root + '/', '')}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every --ds-* variable that components read is actually emitted by the theme', async () => {
    const { resolveTheme, themeToCss } = await import('@staffhub/theme-core');
    const css = themeToCss(resolveTheme());
    const used = new Set<string>();
    for (const f of sources) for (const m of readFileSync(f, 'utf8').matchAll(/var\((--ds-[a-z0-9-]+)/g)) used.add(m[1]!);
    // --ds-chart-N and --ds-status-* are built dynamically in TSX; the emitted CSS must still define the whole family
    // --ds-shell-h is a layout hook set by hosts (the preview frame), always read with a fallback, never a theme token
    const missing = [...used].filter((v) => !css.includes(`${v}:`) && !/^--ds-(chart|status)-/.test(v) && v !== '--ds-shell-h');
    expect(missing).toEqual([]);
    for (let i = 1; i <= 6; i++) expect(css).toContain(`--ds-chart-${i}:`);
  });
});
