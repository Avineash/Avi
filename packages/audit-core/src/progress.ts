import { allSteps, isPhase } from './template.ts';
import type { AuditStep, AuditTemplate, Progress, StepState, StepStates } from './types.ts';

export const emptyState = (): StepState => ({ done: false, initials: '', note: '', subs: [] });

export function computeProgress(t: AuditTemplate, states: StepStates): Progress {
  const phases = t.phases.filter(isPhase).map((p) => {
    const done = p.steps.filter((s) => states[s.id]?.done).length;
    return { id: p.id, name: p.name, total: p.steps.length, done, complete: done === p.steps.length };
  });
  const total = phases.reduce((n, p) => n + p.total, 0), done = phases.reduce((n, p) => n + p.done, 0);
  const first = allSteps(t).find(({ step }) => !states[step.id]?.done);
  return {
    total, done, percent: total ? Math.round((done / total) * 100) : 0,
    next: first ? { phaseId: first.phase.id, phaseName: first.phase.name, step: first.step } : null,
    phases,
  };
}

/** Steps shown in the simplified view. Falls back to all steps for a phase that marks none as key. */
export function simplifiedSteps(t: AuditTemplate): Array<{ phaseId: string; step: AuditStep }> {
  return allSteps(t).filter(({ step }) => step.key).map(({ phase, step }) => ({ phaseId: phase.id, step }));
}

/** Has the system roll step been completed? Used to tell pre-roll from post-roll work. */
export function isRolled(t: AuditTemplate, states: StepStates): boolean {
  const roll = allSteps(t).find(({ step }) => step.roll);
  return roll ? !!states[roll.step.id]?.done : false;
}

/** "Amelia Hart" → "AH". */
export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]!.toUpperCase()).join('');
}

/**
 * Sanitises a client-supplied step update. Returns only the fields that are valid; never trusts lengths or indexes.
 */
export function cleanStepPatch(step: AuditStep, input: unknown): { ok: true; patch: Partial<StepState> } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'Body must be an object.' };
  const i = input as Record<string, unknown>;
  for (const k of Object.keys(i)) if (!['done', 'initials', 'note', 'subs'].includes(k)) return { ok: false, error: `Unknown field "${k}".` };
  const patch: Partial<StepState> = {};
  if (i.done !== undefined) { if (typeof i.done !== 'boolean') return { ok: false, error: 'done must be true or false.' }; patch.done = i.done; }
  if (i.initials !== undefined) {
    if (typeof i.initials !== 'string' || i.initials.length > 4 || /[^A-Za-z]/.test(i.initials)) return { ok: false, error: 'Initials are 1–4 letters.' };
    patch.initials = i.initials.toUpperCase();
  }
  if (i.note !== undefined) { if (typeof i.note !== 'string' || i.note.length > 1000) return { ok: false, error: 'Notes are limited to 1000 characters.' }; patch.note = i.note; }
  if (i.subs !== undefined) {
    const n = step.subs?.length ?? 0;
    if (!Array.isArray(i.subs) || !i.subs.every((x) => Number.isInteger(x) && x >= 0 && x < n)) return { ok: false, error: 'subs must list valid sub-task numbers.' };
    patch.subs = [...new Set(i.subs as number[])].sort((a, b) => a - b);
  }
  return { ok: true, patch };
}
