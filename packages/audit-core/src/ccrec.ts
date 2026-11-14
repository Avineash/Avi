/**
 * Card reconciliation: does what the PMS says was paid by card match what the terminals settled?
 * All money is whole cents, so totals never drift. Variance = terminals − PMS (positive: terminals hold more).
 */
export interface CcRecRow { card: string; pms: number; terminalFo: number; terminalFb: number }
export interface PaylinkRow { ref: string; room: string; amount: number; posted: boolean }
export interface CcRecData { tolerance: number; rows: CcRecRow[]; paylinks: PaylinkRow[]; note: string }

export const DEFAULT_CARDS = ['Visa', 'Mastercard', 'Amex', 'Diners', 'UnionPay', 'EFTPOS'];
export const emptyCcRec = (): CcRecData => ({ tolerance: 0, rows: DEFAULT_CARDS.map((card) => ({ card, pms: 0, terminalFo: 0, terminalFb: 0 })), paylinks: [], note: '' });

export interface CcRecResult {
  rows: Array<CcRecRow & { terminals: number; variance: number; balanced: boolean }>;
  totals: { pms: number; terminals: number; variance: number };
  unpostedPaylinks: number;
  balanced: boolean;
}

export function computeCcRec(d: CcRecData): CcRecResult {
  const rows = d.rows.map((r) => {
    const terminals = r.terminalFo + r.terminalFb, variance = terminals - r.pms;
    return { ...r, terminals, variance, balanced: Math.abs(variance) <= d.tolerance };
  });
  const totals = rows.reduce((t, r) => ({ pms: t.pms + r.pms, terminals: t.terminals + r.terminals, variance: t.variance + r.variance }), { pms: 0, terminals: 0, variance: 0 });
  const unpostedPaylinks = d.paylinks.filter((p) => !p.posted).reduce((n, p) => n + p.amount, 0);
  return { rows, totals, unpostedPaylinks, balanced: rows.every((r) => r.balanced) && unpostedPaylinks === 0 };
}

/** "1,234.50" or "$1234.5" → 123450. Returns null for anything that isn't a plain money amount. */
export function parseCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^-?\d{0,9}(\.\d{0,2})?$/.test(s) || s === '' || s === '-' || s === '.') return null;
  const neg = s.startsWith('-');
  const [w = '0', f = ''] = s.replace('-', '').split('.');
  const cents = Number(w || '0') * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
}
export const formatCents = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function validateCcRec(input: unknown): { ok: true; data: CcRecData } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'Body must be an object.' };
  const i = input as Record<string, unknown>;
  for (const k of Object.keys(i)) if (!['tolerance', 'rows', 'paylinks', 'note'].includes(k)) return { ok: false, error: `Unknown field "${k}".` };
  const money = (v: unknown) => Number.isInteger(v) && Math.abs(v as number) <= 100_000_000_00;
  if (!money(i.tolerance) || (i.tolerance as number) < 0) return { ok: false, error: 'tolerance must be a non-negative whole number of cents.' };
  if (!Array.isArray(i.rows) || i.rows.length < 1 || i.rows.length > 20) return { ok: false, error: 'rows must list 1–20 card types.' };
  const rows: CcRecRow[] = [];
  for (const r of i.rows as unknown[]) {
    const o = r as Record<string, unknown>;
    if (typeof o !== 'object' || o === null || typeof o.card !== 'string' || !o.card.trim() || o.card.length > 30 || /[<>]/.test(o.card) || !money(o.pms) || !money(o.terminalFo) || !money(o.terminalFb)) return { ok: false, error: 'Each row needs a card name and whole-cent amounts.' };
    rows.push({ card: o.card.trim(), pms: o.pms as number, terminalFo: o.terminalFo as number, terminalFb: o.terminalFb as number });
  }
  const paylinks: PaylinkRow[] = [];
  if (i.paylinks !== undefined) {
    if (!Array.isArray(i.paylinks) || i.paylinks.length > 100) return { ok: false, error: 'paylinks must be a list of up to 100 payments.' };
    for (const p of i.paylinks as unknown[]) {
      const o = p as Record<string, unknown>;
      if (typeof o !== 'object' || o === null || typeof o.ref !== 'string' || o.ref.length > 40 || /[<>]/.test(o.ref) || typeof o.room !== 'string' || o.room.length > 12 || /[<>]/.test(o.room) || !money(o.amount) || typeof o.posted !== 'boolean') return { ok: false, error: 'Each payment link needs a reference, room, amount and posted flag.' };
      paylinks.push({ ref: o.ref, room: o.room, amount: o.amount as number, posted: o.posted });
    }
  }
  const note = typeof i.note === 'string' ? i.note : '';
  if (note.length > 1000) return { ok: false, error: 'Note is limited to 1000 characters.' };
  return { ok: true, data: { tolerance: i.tolerance as number, rows, paylinks, note } };
}
