import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE, allSteps, buildSummary, businessDate, cleanStepPatch, computeCcRec, computeProgress, defaultAuditDate, emptyCcRec,
  emptyState, formatCents, initialsOf, isRolled, isYmd, parseCents, simplifiedSteps, validateCcRec, validateTemplate, type StepStates,
} from './index.ts';

describe('template validation', () => {
  it('accepts the shipped default template and round-trips it unchanged', () => {
    const r = validateTemplate(DEFAULT_TEMPLATE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.template).toEqual(DEFAULT_TEMPLATE);
  });
  it('has unique ids, exactly one roll step and one roll marker, and a sane size', () => {
    const steps = allSteps(DEFAULT_TEMPLATE);
    expect(new Set(steps.map((s) => s.step.id)).size).toBe(steps.length);
    expect(steps.filter((s) => s.step.roll)).toHaveLength(1);
    expect(DEFAULT_TEMPLATE.phases.filter((p) => p.kind === 'roll')).toHaveLength(1);
    expect(steps.length).toBeGreaterThan(40);
  });
  it.each([
    ['not an object', 'x'],
    ['no phases', { name: 'x', phases: [] }],
    ['unknown top-level key', { ...DEFAULT_TEMPLATE, extra: 1 }],
    ['markup in text', { name: 'x', phases: [{ id: 'a', name: 'A', when: 'pre', steps: [{ id: 's', text: '<img onerror=x>' }] }] }],
    ['duplicate step ids', { name: 'x', phases: [{ id: 'a', name: 'A', when: 'pre', steps: [{ id: 's', text: 'one' }, { id: 's', text: 'two' }] }] }],
    ['bad phase timing', { name: 'x', phases: [{ id: 'a', name: 'A', when: 'later', steps: [{ id: 's', text: 'one' }] }] }],
    ['javascript: link', { name: 'x', phases: [{ id: 'a', name: 'A', when: 'pre', steps: [{ id: 's', text: 'one' }] }], links: { t: { label: 'x', url: 'javascript:alert(1)' } } }],
    ['two roll markers', { name: 'x', phases: [{ id: 'r1', kind: 'roll' }, { id: 'r2', kind: 'roll' }] }],
    ['unknown step field', { name: 'x', phases: [{ id: 'a', name: 'A', when: 'pre', steps: [{ id: 's', text: 'one', color: 'red' }] }] }],
  ])('rejects %s', (_n, input) => expect(validateTemplate(input).ok).toBe(false));
});

describe('progress', () => {
  const states = (...ids: string[]): StepStates => Object.fromEntries(ids.map((id) => [id, { ...emptyState(), done: true }]));
  it('counts steps, finds the next step in order, and reports per-phase completion', () => {
    const p0 = computeProgress(DEFAULT_TEMPLATE, {});
    expect(p0.done).toBe(0);
    expect(p0.next?.step.id).toBe('p0-1');
    const p1 = computeProgress(DEFAULT_TEMPLATE, states('p0-1', 'p0-2', 'p0-3', 'p0-4'));
    expect(p1.phases[0]).toMatchObject({ id: 'p0', done: 4, complete: true });
    expect(p1.next?.step.id).toBe('p1-1');
    expect(p1.percent).toBe(Math.round((4 / p1.total) * 100));
  });
  it('reaches 100% with no next step', () => {
    const all = states(...allSteps(DEFAULT_TEMPLATE).map((s) => s.step.id));
    const p = computeProgress(DEFAULT_TEMPLATE, all);
    expect(p).toMatchObject({ percent: 100, next: null });
  });
  it('knows when the system has been rolled', () => {
    expect(isRolled(DEFAULT_TEMPLATE, {})).toBe(false);
    expect(isRolled(DEFAULT_TEMPLATE, states('p5-7'))).toBe(true);
  });
  it('simplified view shows only key steps', () => {
    const keys = simplifiedSteps(DEFAULT_TEMPLATE);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.length).toBeLessThan(allSteps(DEFAULT_TEMPLATE).length);
  });
  it('sanitises step updates', () => {
    const step = { id: 's', text: 't', subs: ['a', 'b'] };
    expect(cleanStepPatch(step, { done: true, initials: 'ah', subs: [1, 0, 1] })).toEqual({ ok: true, patch: { done: true, initials: 'AH', subs: [0, 1] } });
    for (const bad of [{ done: 'yes' }, { initials: 'A1' }, { initials: 'ABCDE' }, { note: 'x'.repeat(1001) }, { subs: [2] }, { subs: [-1] }, { subs: 'a' }, { color: 1 }, [], null])
      expect(cleanStepPatch(step, bad).ok).toBe(false);
  });
  it('derives initials from a name', () => {
    expect(initialsOf('Amelia Hart')).toBe('AH');
    expect(initialsOf('  ')).toBe('');
  });
});

describe('dates', () => {
  it('business date is the day after the audit date, across month and year ends', () => {
    expect(businessDate('2026-11-13')).toBe('2026-11-14');
    expect(businessDate('2026-02-28')).toBe('2026-03-01');
    expect(businessDate('2026-12-31')).toBe('2027-01-01');
  });
  it('before midday the working audit date is yesterday', () => {
    expect(defaultAuditDate(new Date(2026, 10, 14, 2, 30))).toBe('2026-11-13');
    expect(defaultAuditDate(new Date(2026, 10, 14, 11, 59))).toBe('2026-11-13');
    expect(defaultAuditDate(new Date(2026, 10, 14, 12, 0))).toBe('2026-11-14');
    expect(defaultAuditDate(new Date(2026, 0, 1, 1, 0))).toBe('2025-12-31');
  });
  it('validates calendar dates strictly', () => {
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2028-02-29')).toBe(true);
    for (const bad of ['2026-13-01', '26-01-01', '', null, 20260101]) expect(isYmd(bad)).toBe(false);
  });
});

describe('card reconciliation', () => {
  it('parses and formats money in whole cents without float drift', () => {
    expect(parseCents('1,234.50')).toBe(123450);
    expect(parseCents('$0.1')).toBe(10);
    expect(parseCents('-12')).toBe(-1200);
    expect(parseCents('0.10')! + parseCents('0.20')!).toBe(30);
    for (const bad of ['', '-', '.', 'abc', '1.234', '12e3', '1,2,3x']) expect(parseCents(bad)).toBeNull();
    expect(formatCents(123450)).toBe('$1,234.50');
    expect(formatCents(-5)).toBe('-$0.05');
  });
  it('computes variance per card and in total, within tolerance', () => {
    const d = emptyCcRec();
    d.rows[0] = { card: 'Visa', pms: 100_000, terminalFo: 60_000, terminalFb: 40_000 };
    d.rows[1] = { card: 'Mastercard', pms: 50_000, terminalFo: 49_950, terminalFb: 0 };
    const r = computeCcRec(d);
    expect(r.rows[0]).toMatchObject({ terminals: 100_000, variance: 0, balanced: true });
    expect(r.rows[1]).toMatchObject({ variance: -50, balanced: false });
    expect(r.totals).toEqual({ pms: 150_000, terminals: 149_950, variance: -50 });
    expect(r.balanced).toBe(false);
    expect(computeCcRec({ ...d, tolerance: 50 }).balanced).toBe(true); // variance equal to tolerance passes
  });
  it('treats unposted payment links as not balanced', () => {
    const d = { ...emptyCcRec(), paylinks: [{ ref: 'PL1', room: '512', amount: 25_000, posted: false }] };
    const r = computeCcRec(d);
    expect(r.unpostedPaylinks).toBe(25_000);
    expect(r.balanced).toBe(false);
    expect(computeCcRec({ ...d, paylinks: [{ ...d.paylinks[0]!, posted: true }] }).balanced).toBe(true);
  });
  it('validates card-rec input', () => {
    expect(validateCcRec(emptyCcRec()).ok).toBe(true);
    for (const bad of [null, { ...emptyCcRec(), tolerance: -1 }, { ...emptyCcRec(), tolerance: 1.5 }, { ...emptyCcRec(), rows: [] },
      { ...emptyCcRec(), rows: [{ card: '<b>', pms: 0, terminalFo: 0, terminalFb: 0 }] }, { ...emptyCcRec(), rows: [{ card: 'V', pms: 1.2, terminalFo: 0, terminalFb: 0 }] },
      { ...emptyCcRec(), extra: 1 }, { ...emptyCcRec(), note: 'x'.repeat(1001) }, { ...emptyCcRec(), paylinks: [{ ref: 'a', room: '1', amount: 1, posted: 'yes' }] }])
      expect(validateCcRec(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe('shift summary', () => {
  it('lists progress, initials, notes, outstanding sub-tasks and card-rec status', () => {
    const states: StepStates = {
      'p0-1': { ...emptyState(), done: true, initials: 'AH' },
      'p0-2': { ...emptyState(), note: 'CCTV was down', subs: [0, 1] },
    };
    const d = emptyCcRec(); d.rows[0]!.pms = 1000;
    const text = buildSummary({ propertyName: 'Harbour Hotel', auditDate: '2026-11-13', nightAuditor: 'Amelia Hart', nightManager: 'Sam Lee', status: 'open', template: DEFAULT_TEMPLATE, states, ccrec: d, fileCounts: { 'p0-1': 2 } });
    expect(text).toContain('NIGHT AUDIT: Harbour Hotel');
    expect(text).toContain('business date 2026-11-14');
    expect(text).toContain('[x] Security walk: all levels and plant rooms  (AH)  · 2 file(s)');
    expect(text).toContain('outstanding: CCTV; Messaging; POS');
    expect(text).toContain('note: CCTV was down');
    expect(text).toContain('──── System roll ────');
    expect(text).toContain('NOT balanced');
  });
});
