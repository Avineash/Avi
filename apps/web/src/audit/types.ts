import type { AuditTemplate, Progress, StepState, StepStates } from '@staffhub/audit-core';

export interface RunView {
  exists: true;
  run: { id: string; propertyId: string; propertyName: string; auditDate: string; businessDate: string; status: 'open' | 'closed'; nightAuditor: string; nightManager: string; templateVersion: number; closedAt: string | null; closedBy: string | null; closeNote: string | null };
  template: AuditTemplate; states: StepStates; progress: Progress; rolled: boolean; fileCounts: Record<string, number>;
  lock: { heldBy: string | null; heldByMe: boolean; since: string | null };
  canEdit: boolean; canReopen: boolean;
  lockToken?: string | null;
}
export interface NoRun { exists: false; propertyId: string; propertyName: string; auditDate: string; businessDate: string; template: AuditTemplate; canStart: boolean }
export type AuditView = RunView | NoRun;
export interface RunSummary { id: string; auditDate: string; status: 'open' | 'closed'; nightAuditor: string; percent: number; done: number; total: number; closedAt: string | null; closeNote: string | null; heldBy: string | null }
export interface OverviewRow { propertyId: string; propertyName: string; status: 'not_started' | 'open' | 'closed'; percent: number; nightAuditor: string; heldBy: string | null }
export interface AuditFile { id: string; stepId: string; name: string; mime: string; size: number; uploadedBy: string | null; createdAt: string; expiresAt: string }
export type { StepState };
export const initialsFromName = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]!.toUpperCase()).join('');
