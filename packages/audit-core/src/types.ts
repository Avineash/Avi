/** A checklist step. `id` is stable so progress survives template edits to wording. */
export interface AuditStep {
  id: string;
  text: string;
  /** Main task: also shown in the simplified view. */
  key?: boolean;
  subs?: string[];
  /** Caution shown on the step (e.g. "balance must be 0 before rolling"). */
  warn?: string;
  /** Time window shown as a chip (free text, e.g. "03:00-04:00"). */
  due?: string;
  /** Built-in tool id ("ccrec") or the id of an external link defined in `links`. */
  tool?: string;
  /** The step that rolls the system; progress after it is "post-roll". */
  roll?: boolean;
}
export interface AuditPhase { id: string; name: string; when: 'pre' | 'post'; steps: AuditStep[]; kind?: 'phase' }
/** Visual divider between pre- and post-roll work. */
export interface AuditRollMarker { id: string; kind: 'roll'; label?: string }
export type AuditItem = AuditPhase | AuditRollMarker;
export interface AuditLink { label: string; url: string }
export interface AuditTemplate {
  name: string;
  phases: AuditItem[];
  links?: Record<string, AuditLink>;
  /** Where saved report files are expected: shown as a reference list, never enforced. */
  folders?: Record<string, string[]>;
}

export interface StepState {
  done: boolean;
  initials: string;
  note: string;
  /** Sub-task indexes that are ticked. */
  subs: number[];
  doneAt?: string | null;
  doneBy?: string | null;
}
export type StepStates = Record<string, StepState>;

export interface Progress {
  total: number; done: number; percent: number;
  /** First unfinished step in order, or null when everything is done. */
  next: { phaseId: string; phaseName: string; step: AuditStep } | null;
  phases: Array<{ id: string; name: string; total: number; done: number; complete: boolean }>;
}
