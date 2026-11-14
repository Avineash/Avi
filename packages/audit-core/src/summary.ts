import { businessDate } from './dates.ts';
import { computeProgress } from './progress.ts';
import { computeCcRec, formatCents, type CcRecData } from './ccrec.ts';
import { isPhase } from './template.ts';
import type { AuditTemplate, StepStates } from './types.ts';

export interface SummaryInput {
  propertyName: string; auditDate: string; nightAuditor: string; nightManager: string;
  status: 'open' | 'closed'; template: AuditTemplate; states: StepStates; fileCounts?: Record<string, number>; ccrec?: CcRecData | null;
}

/** Plain-text shift summary: what was done, by whom, with notes: suitable for pasting into an email or handover log. */
export function buildSummary(s: SummaryInput): string {
  const p = computeProgress(s.template, s.states);
  const L: string[] = [];
  L.push(`NIGHT AUDIT: ${s.propertyName}`);
  L.push(`Audit date ${s.auditDate} · business date ${businessDate(s.auditDate)} · ${s.status === 'closed' ? 'CLOSED' : 'in progress'}`);
  L.push(`Night auditor: ${s.nightAuditor || '—'} · Night manager: ${s.nightManager || '—'}`);
  L.push(`Progress: ${p.done}/${p.total} steps (${p.percent}%)`);
  L.push('');
  for (const ph of s.template.phases) {
    if (!isPhase(ph)) { L.push(`──── ${ph.label ?? 'System roll'} ────`, ''); continue; }
    const pp = p.phases.find((x) => x.id === ph.id)!;
    L.push(`${ph.name} (${pp.done}/${pp.total})`);
    for (const st of ph.steps) {
      const x = s.states[st.id];
      L.push(`  [${x?.done ? 'x' : ' '}] ${st.text}${x?.done && x.initials ? `  (${x.initials})` : ''}${s.fileCounts?.[st.id] ? `  · ${s.fileCounts[st.id]} file(s)` : ''}`);
      if (st.subs?.length && x) {
        const open = st.subs.filter((_, i) => !x.subs.includes(i));
        if (!x.done && open.length) L.push(`        outstanding: ${open.join('; ')}`);
      }
      if (x?.note.trim()) L.push(`        note: ${x.note.trim().replace(/\n+/g, ' / ')}`);
    }
    L.push('');
  }
  if (s.ccrec) {
    const r = computeCcRec(s.ccrec);
    L.push(`Card reconciliation: PMS ${formatCents(r.totals.pms)} · terminals ${formatCents(r.totals.terminals)} · variance ${formatCents(r.totals.variance)} · ${r.balanced ? 'balanced' : 'NOT balanced'}`);
    for (const row of r.rows.filter((x) => !x.balanced)) L.push(`  ${row.card}: variance ${formatCents(row.variance)}`);
    if (r.unpostedPaylinks) L.push(`  Unposted payment links: ${formatCents(r.unpostedPaylinks)}`);
    if (s.ccrec.note.trim()) L.push(`  note: ${s.ccrec.note.trim()}`);
  }
  return L.join('\n').trimEnd();
}
