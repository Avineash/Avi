import {
  contrastRatio, deltaE, ensureContrast, ensureContrastAll, hexToHsl, interactiveShade, tintToward,
} from './color.ts';
import type { ResolvedTheme } from './resolve.ts';
import type { Scheme, StatusKey } from './schema.ts';
import { SCHEMES, STATUS_KEYS, STATUS_LABELS } from './schema.ts';
import { setPath } from './config-ops.ts';
import type { ThemeConfig } from './schema.ts';

export type Severity = 'error' | 'warning' | 'info';
export type AuditCategory = 'text' | 'ui' | 'status' | 'convention' | 'note';

export interface AuditIssue {
  id: string;
  severity: Severity;
  category: AuditCategory;
  scheme?: Scheme;
  title: string;
  detail: string;
  /** WCAG 2.2 success criterion the check is based on. */
  criterion?: string;
  ratio?: number;
  required?: number;
  fg?: string;
  bg?: string;
  /** Config path + value that would resolve the issue. */
  fix?: { path: string[]; value: string };
}

export interface AuditReport {
  issues: AuditIssue[];
  /** Number of individual checks evaluated. */
  checks: number;
  errors: number;
  warnings: number;
  infos: number;
  /** Status-colour contrast failures. These can never be published, even with acknowledgement. */
  blocking: AuditIssue[];
  /** Other contrast failures. Publishing requires an explicit acknowledgement. */
  acknowledgeable: AuditIssue[];
}

const CRIT_TEXT = 'WCAG 2.2 AA · 1.4.3 Contrast (Minimum)';
const CRIT_UI = 'WCAG 2.2 AA · 1.4.11 Non-text Contrast';
const round = (n: number) => Math.round(n * 100) / 100;

interface Pair {
  id: string; label: string; fg: string; bg: string; min: number;
  category: AuditCategory; criterion: string; fixPath?: string[]; fixValue?: string;
  /** All backgrounds the fixed colour must clear (a token is often used on several surfaces). */
  fixAgainst?: string[];
}

/** Audits a resolved theme against WCAG 2.2 AA and the status-colour conventions. Pure and fast; safe to run on every edit. */
export function auditTheme(theme: ResolvedTheme): AuditReport {
  const issues: AuditIssue[] = [];
  let checks = 0;

  for (const scheme of SCHEMES) {
    const s = theme.schemes[scheme];
    const c = s.colors;
    const cp = (key: string) => ['colors', scheme, key];
    const name = scheme === 'light' ? 'Light' : 'Dark';

    const pairs: Pair[] = [
      { id: 'text-page', label: 'Body text on page background', fg: c.text, bg: c.pageBg, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('text'), fixAgainst: [c.pageBg, c.surface] },
      { id: 'text-surface', label: 'Body text on cards', fg: c.text, bg: c.surface, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('text'), fixAgainst: [c.pageBg, c.surface] },
      { id: 'muted-surface', label: 'Secondary text on cards', fg: c.mutedText, bg: c.surface, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('mutedText'), fixAgainst: [c.pageBg, c.surface] },
      { id: 'muted-page', label: 'Secondary text on page background', fg: c.mutedText, bg: c.pageBg, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('mutedText'), fixAgainst: [c.pageBg, c.surface] },
      { id: 'btn', label: 'Button label', fg: c.buttonText, bg: c.buttonBg, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('buttonText') },
      { id: 'btn-hover', label: 'Button label (hover)', fg: c.buttonText, bg: c.buttonHoverBg, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('buttonHoverBg'), fixValue: interactiveShade(c.buttonBg, c.buttonText, 0.12) },
      { id: 'btn-active', label: 'Button label (pressed)', fg: c.buttonText, bg: c.buttonActiveBg, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('buttonActiveBg'), fixValue: interactiveShade(c.buttonBg, c.buttonText, 0.22) },
      { id: 'nav', label: 'Navigation text', fg: c.sidebarText, bg: c.sidebarBg, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('sidebarText') },
      { id: 'nav-active', label: 'Active navigation item', fg: c.sidebarText, bg: c.sidebarActive, min: 4.5, category: 'text', criterion: CRIT_TEXT, fixPath: cp('sidebarActive'), fixValue: tintToward(c.sidebarBg, c.sidebarText, 0.16, c.sidebarText) },
      { id: 'secondary-btn', label: 'Secondary button label', fg: s.onSecondary, bg: c.secondary, min: 4.5, category: 'text', criterion: CRIT_TEXT },
      { id: 'input-border', label: 'Form field border', fg: c.inputBorder, bg: c.surface, min: 3, category: 'ui', criterion: CRIT_UI, fixPath: cp('inputBorder'), fixAgainst: [c.pageBg, c.surface] },
      { id: 'focus-surface', label: 'Keyboard focus ring on cards', fg: c.focusRing, bg: c.surface, min: 3, category: 'ui', criterion: CRIT_UI, fixPath: cp('focusRing'), fixAgainst: [c.pageBg, c.surface] },
      { id: 'focus-page', label: 'Keyboard focus ring on page background', fg: c.focusRing, bg: c.pageBg, min: 3, category: 'ui', criterion: CRIT_UI, fixPath: cp('focusRing'), fixAgainst: [c.pageBg, c.surface] },
    ];
    for (const key of STATUS_KEYS) {
      const st = s.status[key];
      pairs.push({
        id: `status-${key}`, label: `${STATUS_LABELS[key]} status badge text`, fg: st.fg, bg: st.bg, min: 4.5,
        category: 'status', criterion: CRIT_TEXT, fixPath: ['status', key, scheme, 'fg'], fixValue: ensureContrast(st.fg, st.bg, 4.5),
      });
    }

    for (const p of pairs) {
      checks++;
      const r = contrastRatio(p.fg, p.bg);
      if (r >= p.min) continue;
      const fixValue = p.fixValue ?? ensureContrastAll(p.fg, p.fixAgainst ?? [p.bg], p.min);
      issues.push({
        id: `${p.id}:${scheme}`, severity: 'error', category: p.category, scheme, criterion: p.criterion,
        title: `${name}: ${p.label}`,
        detail: `Contrast is ${round(r).toFixed(2)}:1; at least ${p.min}:1 is required.`,
        ratio: round(r), required: p.min, fg: p.fg, bg: p.bg,
        ...(p.fixPath ? { fix: { path: p.fixPath, value: fixValue } } : {}),
      });
    }

    // Conventions: statuses should keep their universal colour meaning.
    for (const key of STATUS_KEYS) {
      checks++;
      const msg = conventionProblem(key, s.status[key].fg);
      if (msg) {
        issues.push({
          id: `convention-${key}:${scheme}`, severity: 'warning', category: 'convention', scheme,
          title: `${name}: ${STATUS_LABELS[key]} no longer looks ${expected(key)}`,
          detail: `${msg} People scan leave calendars by colour, so unconventional colours slow them down. The text label and icon are always shown, so the status stays readable.`,
          fg: s.status[key].fg, bg: s.status[key].bg,
        });
      }
    }
    // Statuses must be visually distinct from one another.
    for (let i = 0; i < STATUS_KEYS.length; i++) {
      for (let j = i + 1; j < STATUS_KEYS.length; j++) {
        checks++;
        const a = s.status[STATUS_KEYS[i]!], b = s.status[STATUS_KEYS[j]!];
        const d = Math.max(deltaE(a.fg, b.fg), deltaE(a.bg, b.bg));
        if (d < 10) {
          issues.push({
            id: `distinct-${STATUS_KEYS[i]}-${STATUS_KEYS[j]}:${scheme}`, severity: 'warning', category: 'convention', scheme,
            title: `${name}: ${STATUS_LABELS[STATUS_KEYS[i]!]} and ${STATUS_LABELS[STATUS_KEYS[j]!]} look almost identical`,
            detail: `Their colours differ by only ${round(d)} (ΔE). Make them more distinct so the calendar can be scanned at a glance.`,
          });
        }
      }
    }

    // Notes: where the engine substituted a derived colour so the admin isn't surprised.
    if (c.primary !== s.primaryText) {
      issues.push({
        id: `primary-text:${scheme}`, severity: 'info', category: 'note', scheme,
        title: `${name}: brand colour adjusted for text`,
        detail: `${c.primary} is not readable as text on your card background, so links and brand-coloured text use ${s.primaryText}. Buttons still use your exact colour.`,
        fg: s.primaryText, bg: c.surface,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    issues,
    checks,
    errors: errors.length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
    blocking: errors.filter((i) => i.category === 'status'),
    acknowledgeable: errors.filter((i) => i.category !== 'status'),
  };
}

const expected = (k: StatusKey) => ({ approved: 'green', pending: 'amber', rejected: 'red', cancelled: 'grey' })[k];

function conventionProblem(key: StatusKey, fg: string): string | null {
  const { h, s } = hexToHsl(fg);
  switch (key) {
    case 'approved': return s >= 0.2 && h >= 75 && h <= 175 ? null : 'Approved should be green.';
    case 'pending': return s >= 0.2 && h >= 25 && h <= 65 ? null : 'Pending should be yellow or amber.';
    case 'rejected': return s >= 0.2 && (h <= 20 || h >= 340) ? null : 'Rejected should be red.';
    case 'cancelled': return s <= 0.3 ? null : 'Cancelled should be a neutral grey.';
  }
}

/** Applies suggested fixes to a theme layer. Pass a subset of issues to fix selectively. */
export function applyFixes(layer: ThemeConfig, issues: AuditIssue[]): ThemeConfig {
  let out = layer;
  for (const i of issues) if (i.fix) out = setPath(out, i.fix.path, i.fix.value);
  return out;
}
