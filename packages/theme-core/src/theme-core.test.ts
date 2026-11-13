import { describe, expect, it } from 'vitest';
import {
  PRESETS, STATUS_KEYS, SYSTEM_DEFAULT_THEME, applyFixes, applyPreset, auditTheme, contrastRatio, customBrandConfig,
  deletePath, diffConfigs, ensureContrast, fingerprint, generatePalette, getPath, hslToHex, mergeConfigs,
  normalizeHex, normalizePolicy, policyViolations, resolveTheme, setPath, summarizeChanges, themeToCss,
  validateThemeConfig, DEFAULT_OVERRIDE_POLICY, DEFAULT_STATUS_COLORS, readableOn,
} from './index.ts';

describe('colour maths', () => {
  it('matches published WCAG contrast values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2); // the classic "just fails AA" grey
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('normalises hex input and rejects junk', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('1D4ED8')).toBe('#1d4ed8');
    for (const bad of ['#12345', 'red', '#gggggg', 'url(x)', '', null, 12, '#12345678']) expect(normalizeHex(bad)).toBeNull();
  });
  it('ensureContrast makes the smallest change that passes and keeps passing colours', () => {
    expect(ensureContrast('#111111', '#ffffff', 4.5)).toBe('#111111');
    const fixed = ensureContrast('#9ca3af', '#ffffff', 4.5);
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('readableOn always reaches 4.5:1, even on mid-tone backgrounds', () => {
    for (const bg of ['#8c7373', '#778217', '#d94a26', '#737a8c', '#808080'])
      expect(contrastRatio(readableOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('presets and generated palettes', () => {
  it('ships the six requested presets', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'premium-hospitality', 'modern-corporate', 'minimal-monochrome', 'boutique-hotel', 'luxury-dark', 'custom-brand',
    ]);
  });
  it.each(PRESETS.map((p) => [p.id, p] as const))('%s passes WCAG 2.2 AA with no errors or warnings', (_id, preset) => {
    const report = auditTheme(resolveTheme(preset.config));
    expect(report.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });
  it('default status colours are ≥ 7:1 in both schemes', () => {
    for (const k of STATUS_KEYS) for (const s of ['light', 'dark'] as const) {
      const p = DEFAULT_STATUS_COLORS[k][s]!;
      expect(contrastRatio(p.fg!, p.bg!)).toBeGreaterThanOrEqual(7);
    }
  });
  it('a generated palette is accessible for any brand colour (1,200-colour sweep)', () => {
    const failures: string[] = [];
    for (let h = 0; h < 360; h += 6) for (const s of [0.1, 0.4, 0.7, 1]) for (const l of [0.15, 0.3, 0.5, 0.7, 0.9]) {
      const hex = hslToHex({ h, s, l });
      const r = auditTheme(resolveTheme(customBrandConfig(hex)));
      if (r.errors) failures.push(`${hex}: ${r.issues.filter((i) => i.severity === 'error').map((i) => i.id).join(',')}`);
    }
    expect(failures).toEqual([]);
  });
  it('keeps the chosen brand colour exactly in light mode', () => {
    expect(generatePalette('#C0392B').light.primary).toBe('#c0392b');
  });
  it('applying a preset leaves identity and status alone and respects locked groups', () => {
    const layer = { identity: { companyName: 'Acme' }, status: { approved: { light: { fg: '#004d00' } } }, shape: { radius: 'none' as const } };
    const luxury = PRESETS.find((p) => p.id === 'luxury-dark')!;
    const out = applyPreset(layer, luxury, { shape: false });
    expect(out.identity?.companyName).toBe('Acme');
    expect(out.status?.approved?.light?.fg).toBe('#004d00');
    expect(out.shape?.radius).toBe('none'); // shape locked → untouched
    expect(out.colors?.dark?.primary).toBe('#c9a35b');
    expect(out.mode?.default).toBe('dark');
  });
});

describe('inheritance', () => {
  const company = { identity: { companyName: 'Aurora', logoAssetId: '11111111-1111-4111-8111-111111111111' }, colors: { light: { primary: '#0f5c5a' } } };
  const property = { identity: { propertyName: 'Harbour', logoAssetId: null } };

  it('merges system default → company → property', () => {
    const t = resolveTheme(company, property);
    expect(t.identity.companyName).toBe('Aurora');
    expect(t.identity.propertyName).toBe('Harbour');
    expect(t.identity.displayName).toBe('Harbour');
    expect(t.schemes.light.colors.primary).toBe('#0f5c5a');
    // untouched values fall through to the system default
    expect(t.schemes.dark.colors.primary).toBe(SYSTEM_DEFAULT_THEME.colors!.dark!.primary);
  });
  it('treats null as an explicit "none" (property can remove an inherited logo)', () => {
    expect(resolveTheme(company).identity.logoAssetId).toBe('11111111-1111-4111-8111-111111111111');
    expect(resolveTheme(company, property).identity.logoAssetId).toBeNull();
  });
  it('does not mutate its inputs', () => {
    const snapshot = JSON.stringify([company, property]);
    mergeConfigs(company, property);
    resolveTheme(company, property);
    expect(JSON.stringify([company, property])).toBe(snapshot);
  });
  it('derived tokens follow their seeds: changing primary re-derives hover/active/focus', () => {
    const a = resolveTheme({ colors: { light: { primary: '#0f5c5a' } } }).schemes.light.colors;
    const b = resolveTheme({ colors: { light: { primary: '#9b3d55' } } }).schemes.light.colors;
    expect(a.buttonBg).toBe('#0f5c5a');
    expect(b.buttonBg).toBe('#9b3d55');
    expect(a.buttonHoverBg).not.toBe(b.buttonHoverBg);
  });
  it('explicit overrides beat derivation', () => {
    const t = resolveTheme({ colors: { light: { buttonBg: '#aa0000', buttonText: '#ffffff' } } });
    expect(t.schemes.light.colors.buttonBg).toBe('#aa0000');
    expect(t.schemes.light.colors.buttonText).toBe('#ffffff');
  });
  it('fingerprint is order-independent and sensitive to change', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe('config operations', () => {
  it('get/set/delete are immutable and prune empty branches', () => {
    const base = { colors: { light: { primary: '#111111' } } };
    const added = setPath(base, ['colors', 'dark', 'primary'], '#eeeeee');
    expect(getPath(added, ['colors', 'dark', 'primary'])).toBe('#eeeeee');
    expect(getPath(base, ['colors', 'dark', 'primary'])).toBeUndefined();
    const removed = deletePath(deletePath(added, ['colors', 'dark', 'primary']), ['colors', 'light', 'primary']);
    expect(removed).toEqual({});
  });
  it('diff + summary report what changed per group', () => {
    const before = { colors: { light: { primary: '#111111' } }, shape: { radius: 'none' as const } };
    const after = { colors: { light: { primary: '#222222', accent: '#333333' } } };
    const changes = diffConfigs(before, after);
    expect(changes.map((c) => c.path)).toEqual(['colors.light.accent', 'colors.light.primary', 'shape.radius']);
    expect(summarizeChanges(changes)).toEqual([
      { group: 'colors', label: 'Brand & interface colors', count: 2 },
      { group: 'shape', label: 'Corners & density', count: 1 },
    ]);
  });
  it('override policy flags only the groups a layer touches', () => {
    const policy = normalizePolicy({ colors: true });
    expect(policy).toEqual({ ...DEFAULT_OVERRIDE_POLICY, colors: true });
    expect(policyViolations({ identity: { propertyName: 'X' }, colors: { light: { primary: '#111111' } }, shape: { radius: 'soft' } }, policy)).toEqual(['shape']);
    expect(policyViolations({}, policy)).toEqual([]);
  });
});

describe('validation (hostile input)', () => {
  it('accepts a sane layer and normalises colours', () => {
    const r = validateThemeConfig({ colors: { light: { primary: '#ABC' } }, typography: { bodyFont: 'inter' } });
    expect(r).toEqual({ ok: true, config: { colors: { light: { primary: '#aabbcc' } }, typography: { bodyFont: 'inter' } } });
  });
  it.each([
    ['css injection via colour', { colors: { light: { primary: 'red;}body{display:none' } } }],
    ['url() in colour', { colors: { light: { primary: 'url(//evil)' } } }],
    ['css injection via font', { typography: { bodyFont: 'x";}body{background:red' } }],
    ['unknown top-level key', { custom: 1 }],
    ['unknown colour key', { colors: { light: { primaryy: '#111111' } } }],
    ['unknown status', { status: { vip: {} } }],
    ['bad radius', { shape: { radius: '999px' } }],
    ['asset id that is not a uuid', { identity: { logoAssetId: '../../etc/passwd' } }],
    ['html in name', { identity: { companyName: '<script>alert(1)</script>' } }],
    ['over-long name', { identity: { companyName: 'x'.repeat(81) } }],
    ['empty company name', { identity: { companyName: '  ' } }],
    ['non-object', 'nope'],
    ['array', []],
  ])('rejects %s', (_n, input) => {
    expect(validateThemeConfig(input).ok).toBe(false);
  });
});

describe('CSS generation', () => {
  const css = themeToCss(resolveTheme(PRESETS[0]!.config));
  it('emits tokens for light, dark and system', () => {
    expect(css).toContain(':root{');
    expect(css).toContain(':root[data-scheme="dark"]{');
    expect(css).toContain('@media (prefers-color-scheme:dark){:root[data-scheme="system"]{');
    for (const t of ['--ds-primary', '--ds-btn-bg-hover', '--ds-nav-bg', '--ds-status-approved-fg', '--ds-chart-6', '--ds-font-heading', '--ds-radius-btn', '--ds-row-h'])
      expect(css).toContain(`${t}:`);
  });
  it('scopes to a custom selector for isolated previews', () => {
    expect(themeToCss(resolveTheme(), { selector: '[data-ds-scope="p1"]' })).toContain('[data-ds-scope="p1"][data-scheme="dark"]{');
  });
  it('never emits anything but known-safe values', () => {
    const decls = css.match(/--ds-[a-z0-9-]+:[^;}]+/g)!;
    for (const d of decls) {
      const v = d.slice(d.indexOf(':') + 1);
      expect(v).toMatch(/^(#[0-9a-f]{6}|\d+(\.\d+)?px|rgb\([^)]*\)(, ?[^;]*)?|[\w "',.\- ()/]+)$/i);
    }
  });
});

describe('accessibility audit', () => {
  it('flags low-contrast body text, offers a fix, and the fix clears it', () => {
    const layer = { colors: { light: { text: '#b0b0b0' } } };
    const report = auditTheme(resolveTheme(layer));
    const issue = report.issues.find((i) => i.id === 'text-surface:light')!;
    expect(issue.severity).toBe('error');
    expect(issue.ratio).toBeLessThan(4.5);
    const fixed = auditTheme(resolveTheme(applyFixes(layer, report.issues)));
    expect(fixed.errors).toBe(0);
  });
  it('treats status contrast failures as blocking, brand failures as acknowledgeable', () => {
    const report = auditTheme(resolveTheme({
      colors: { light: { text: '#b0b0b0' } },
      status: { approved: { light: { bg: '#dff5e6', fg: '#8fd3a5' } } },
    }));
    expect(report.blocking.map((i) => i.id)).toEqual(['status-approved:light']);
    expect(report.acknowledgeable.length).toBeGreaterThan(0);
  });
  it('checks button hover/pressed states, not just the resting state', () => {
    const report = auditTheme(resolveTheme({ colors: { light: { buttonBg: '#2b6cb0', buttonText: '#ffffff', buttonHoverBg: '#90cdf4' } } }));
    expect(report.issues.map((i) => i.id)).toContain('btn-hover:light');
    expect(report.issues.map((i) => i.id)).not.toContain('btn:light');
  });
  it('warns when a status drifts from its conventional colour (and keeps the text label requirement implicit)', () => {
    const report = auditTheme(resolveTheme({ status: { approved: { light: { bg: '#fde4e1', fg: '#8a1c13' } } } }));
    expect(report.issues.find((i) => i.id === 'convention-approved:light')?.severity).toBe('warning');
  });
  it('warns when two statuses are nearly indistinguishable', () => {
    const same = { bg: '#dff5e6', fg: '#14532d' };
    const report = auditTheme(resolveTheme({ status: { pending: { light: same }, approved: { light: same } } }));
    expect(report.issues.some((i) => i.id.startsWith('distinct-approved-pending'))).toBe(true);
  });
  it('explains when the brand colour was adjusted to be readable as text', () => {
    const report = auditTheme(resolveTheme({ colors: { light: { primary: '#f5d90a' } } }));
    expect(report.issues.find((i) => i.id === 'primary-text:light')?.severity).toBe('info');
  });
  it('derived chart colours always reach 3:1 on the card surface', () => {
    for (const p of PRESETS) {
      const t = resolveTheme(p.config);
      for (const s of ['light', 'dark'] as const)
        for (const c of t.schemes[s].charts) expect(contrastRatio(c, t.schemes[s].colors.surface)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('info tone', () => {
  it('is neutral: never derived from the brand colour, so it cannot be mistaken for a status', () => {
    const a = resolveTheme({ colors: { light: { primary: '#9b3d55' } } }).schemes.light.info;
    const b = resolveTheme({ colors: { light: { primary: '#0f5c5a' } } }).schemes.light.info;
    expect(a).toEqual(b);
    for (const p of PRESETS) {
      const t = resolveTheme(p.config);
      for (const s of ['light', 'dark'] as const) expect(contrastRatio(t.schemes[s].info.fg, t.schemes[s].info.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
