import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_TEMPLATE, allSteps, buildSummary, businessDate, cleanStepPatch, computeProgress, emptyCcRec, emptyState, initialsOf, isRolled, isYmd,
  validateCcRec, validateTemplate, type AuditTemplate, type CcRecData, type StepState, type StepStates,
} from '@staffhub/audit-core';
import type { Ctx } from '../auth.ts';
import { log } from '../brand/store.ts';
import { all, get, now, run, tx, type DB } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound } from '../http.ts';
import { FILE_RETENTION_DAYS, safeFileName, sniffReport } from './files.ts';

/** A lock not refreshed for this long can be taken without confirmation (the holder closed their laptop). */
export const LOCK_STALE_MS = 90_000;

interface RunRow {
  id: string; company_id: string; property_id: string; audit_date: string; status: 'open' | 'closed'; template_version: number; template: string;
  night_auditor: string; night_manager: string; lock_user_id: string | null; lock_name: string | null; lock_token: string | null; lock_heartbeat: string | null;
  created_by: string | null; created_at: string; closed_by: string | null; closed_at: string | null; close_note: string | null;
}
interface StepRow { step_id: string; done: number; initials: string; note: string; subs: string; done_by: string | null; done_at: string | null }

// ─────────────────────────── permissions & scope ───────────────────────────

export const canEditRole = (ctx: Ctx) => ctx.auditAccess === 'auditor' || ctx.auditAccess === 'both';
export const isAdminRole = (ctx: Ctx) => ctx.role === 'company_admin' || ctx.role === 'property_admin';
/** May see night-audit data at all (workers with access, plus administrators within their scope). */
export const canViewAudit = (ctx: Ctx) => ctx.auditAccess !== null || isAdminRole(ctx);
export const hasAuditModule = canViewAudit;

export function assertView(ctx: Ctx) { if (!canViewAudit(ctx)) throw forbidden('You do not have access to the night audit.'); }

/** Properties whose audits the caller may see: their own, or every property of the company for a company administrator. */
export function accessibleProperties(db: DB, ctx: Ctx): Array<{ id: string; name: string }> {
  assertView(ctx);
  if (ctx.role === 'company_admin') return all(db, 'SELECT id, name FROM properties WHERE company_id = ? ORDER BY name', ctx.companyId);
  if (!ctx.propertyId) return [];
  return all(db, 'SELECT id, name FROM properties WHERE id = ? AND company_id = ?', ctx.propertyId, ctx.companyId);
}

/** Resolves `propertyId` inside the caller's scope. A property of another tenant is indistinguishable from a missing one. */
export function resolveProperty(db: DB, ctx: Ctx, propertyId: unknown): { id: string; name: string } {
  const list = accessibleProperties(db, ctx);
  if (propertyId === undefined || propertyId === null || propertyId === '') {
    if (list.length === 1) return list[0]!;
    throw badRequest('propertyId is required.');
  }
  const p = list.find((x) => x.id === propertyId);
  if (!p) throw notFound('Property not found.');
  return p;
}

const canEditProperty = (ctx: Ctx, propertyId: string) => canEditRole(ctx) && ctx.propertyId === propertyId;

// ─────────────────────────── template ───────────────────────────

export function getTemplate(db: DB, companyId: string, propertyId: string): { version: number; template: AuditTemplate } {
  const row = get<{ version: number; config: string }>(db, 'SELECT version, config FROM audit_templates WHERE company_id = ? AND property_id = ? ORDER BY version DESC LIMIT 1', companyId, propertyId);
  return row ? { version: row.version, template: JSON.parse(row.config) as AuditTemplate } : { version: 0, template: DEFAULT_TEMPLATE };
}

export function saveTemplate(db: DB, ctx: Ctx, propertyId: unknown, input: unknown) {
  if (!isAdminRole(ctx)) throw forbidden('Only administrators can change the checklist.');
  const prop = resolveProperty(db, ctx, propertyId);
  if (ctx.role === 'property_admin' && ctx.propertyId !== prop.id) throw forbidden();
  const r = validateTemplate(input);
  if (!r.ok) throw new HttpError(400, 'invalid_template', 'The checklist has problems.', { errors: r.errors });
  return tx(db, () => {
    const version = (get<{ v: number | null }>(db, 'SELECT MAX(version) AS v FROM audit_templates WHERE property_id = ?', prop.id)?.v ?? 0) + 1;
    run(db, 'INSERT INTO audit_templates (id, company_id, property_id, version, config, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
      randomUUID(), ctx.companyId, prop.id, version, JSON.stringify(r.template), ctx.userId, now());
    log(db, ctx, 'audit.template', JSON.stringify({ property: prop.id, version }));
    return { version };
  });
}

// ─────────────────────────── runs ───────────────────────────

function loadRun(db: DB, ctx: Ctx, runId: string): RunRow {
  assertView(ctx);
  const row = get<RunRow>(db, 'SELECT * FROM audit_runs WHERE id = ? AND company_id = ?', runId, ctx.companyId);
  // Property-bound users only see their own property's audits; another tenant's run is simply "not found".
  if (!row || (ctx.role !== 'company_admin' && row.property_id !== ctx.propertyId)) throw notFound('Audit not found.');
  return row;
}

function statesOf(db: DB, runId: string): StepStates {
  const out: StepStates = {};
  for (const r of all<StepRow>(db, 'SELECT * FROM audit_steps WHERE run_id = ?', runId)) {
    out[r.step_id] = { done: !!r.done, initials: r.initials, note: r.note, subs: JSON.parse(r.subs) as number[], doneAt: r.done_at, doneBy: r.done_by };
  }
  return out;
}
const fileCounts = (db: DB, runId: string): Record<string, number> =>
  Object.fromEntries(all<{ step_id: string; n: number }>(db, 'SELECT step_id, COUNT(*) AS n FROM audit_files WHERE run_id = ? GROUP BY step_id', runId).map((r) => [r.step_id, r.n]));

const lockFresh = (r: RunRow) => !!r.lock_user_id && !!r.lock_heartbeat && Date.now() - Date.parse(r.lock_heartbeat) < LOCK_STALE_MS;

export function presentRun(db: DB, ctx: Ctx, row: RunRow, token?: string | null) {
  const template = JSON.parse(row.template) as AuditTemplate;
  const states = statesOf(db, row.id);
  const prop = get<{ name: string }>(db, 'SELECT name FROM properties WHERE id = ?', row.property_id)!;
  const mine = !!token && row.lock_token === token && row.lock_user_id === ctx.userId;
  return {
    exists: true as const,
    run: {
      id: row.id, propertyId: row.property_id, propertyName: prop.name, auditDate: row.audit_date, businessDate: businessDate(row.audit_date), status: row.status,
      nightAuditor: row.night_auditor, nightManager: row.night_manager, templateVersion: row.template_version,
      closedAt: row.closed_at, closedBy: row.closed_by, closeNote: row.close_note,
    },
    template, states, progress: computeProgress(template, states), rolled: isRolled(template, states), fileCounts: fileCounts(db, row.id),
    lock: { heldBy: lockFresh(row) ? row.lock_name : null, heldByMe: mine, since: row.lock_heartbeat },
    canEdit: row.status === 'open' && canEditProperty(ctx, row.property_id),
    canReopen: row.status === 'closed' && isAdminRole(ctx) && (ctx.role === 'company_admin' || ctx.propertyId === row.property_id),
  };
}

export function getRun(db: DB, ctx: Ctx, propertyId: unknown, date: unknown, token?: string | null) {
  const prop = resolveProperty(db, ctx, propertyId);
  if (!isYmd(date)) throw badRequest('date must be a valid YYYY-MM-DD date.');
  const row = get<RunRow>(db, 'SELECT * FROM audit_runs WHERE property_id = ? AND company_id = ? AND audit_date = ?', prop.id, ctx.companyId, date);
  if (!row) {
    const t = getTemplate(db, ctx.companyId, prop.id);
    return { exists: false as const, propertyId: prop.id, propertyName: prop.name, auditDate: date, businessDate: businessDate(date), template: t.template, canStart: canEditProperty(ctx, prop.id) };
  }
  return presentRun(db, ctx, row, token);
}

function grant(db: DB, ctx: Ctx, row: RunRow): string {
  const token = randomBytes(18).toString('base64url');
  run(db, 'UPDATE audit_runs SET lock_user_id = ?, lock_name = ?, lock_token = ?, lock_heartbeat = ? WHERE id = ?', ctx.userId, ctx.name, token, now(), row.id);
  return token;
}

/** Starts the audit for a date if needed and takes the edit lock when it is free (or stale, or already the caller's). */
export function openRun(db: DB, ctx: Ctx, propertyId: unknown, date: unknown) {
  const prop = resolveProperty(db, ctx, propertyId);
  if (!canEditProperty(ctx, prop.id)) throw forbidden('Only a night auditor of this property can run the audit.');
  if (!isYmd(date)) throw badRequest('date must be a valid YYYY-MM-DD date.');
  return tx(db, () => {
    let row = get<RunRow>(db, 'SELECT * FROM audit_runs WHERE property_id = ? AND company_id = ? AND audit_date = ?', prop.id, ctx.companyId, date);
    if (!row) {
      const t = getTemplate(db, ctx.companyId, prop.id);
      run(db, `INSERT INTO audit_runs (id, company_id, property_id, audit_date, template_version, template, night_auditor, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        randomUUID(), ctx.companyId, prop.id, date, t.version, JSON.stringify(t.template), ctx.name, ctx.userId, now());
      row = get<RunRow>(db, 'SELECT * FROM audit_runs WHERE property_id = ? AND audit_date = ?', prop.id, date)!;
      log(db, ctx, 'audit.open', JSON.stringify({ property: prop.id, date }));
    }
    let token: string | null = null;
    if (row.status === 'open' && (!lockFresh(row) || row.lock_user_id === ctx.userId)) {
      token = grant(db, ctx, row);
      row = get<RunRow>(db, 'SELECT * FROM audit_runs WHERE id = ?', row.id)!;
    }
    return { ...presentRun(db, ctx, row, token), lockToken: token };
  });
}

/** Explicit take-over of a live lock. The previous holder's next write is rejected with `locked`. */
export function takeOver(db: DB, ctx: Ctx, runId: string) {
  const row = loadRun(db, ctx, runId);
  if (!canEditProperty(ctx, row.property_id)) throw forbidden('Only a night auditor of this property can take over.');
  if (row.status !== 'open') throw new HttpError(409, 'closed', 'This audit is closed.');
  return tx(db, () => {
    const previous = lockFresh(row) ? row.lock_name : null;
    const token = grant(db, ctx, row);
    if (previous && row.lock_user_id !== ctx.userId) log(db, ctx, 'audit.takeover', JSON.stringify({ run: row.id, from: previous }));
    return { ...presentRun(db, ctx, get<RunRow>(db, 'SELECT * FROM audit_runs WHERE id = ?', row.id)!, token), lockToken: token };
  });
}

function requireLock(row: RunRow, ctx: Ctx, token: string | null | undefined) {
  if (!canEditProperty(ctx, row.property_id)) throw forbidden('You can view this audit but not change it.');
  if (row.status !== 'open') throw new HttpError(409, 'closed', 'This audit is closed and cannot be changed.');
  // The token must be the current one AND belong to the caller: a lock is bound to its holder, not just to a secret.
  if (!token || row.lock_token !== token || row.lock_user_id !== ctx.userId) throw new HttpError(409, 'locked', row.lock_name && lockFresh(row) ? `${row.lock_name} is working on this audit.` : 'You no longer hold the edit lock.', { holder: lockFresh(row) ? row.lock_name : null });
}

export function heartbeat(db: DB, ctx: Ctx, runId: string, token: string | null) {
  const row = loadRun(db, ctx, runId);
  requireLock(row, ctx, token);
  run(db, 'UPDATE audit_runs SET lock_heartbeat = ? WHERE id = ?', now(), row.id);
  return { ok: true };
}

export function release(db: DB, ctx: Ctx, runId: string, token: string | null) {
  const row = loadRun(db, ctx, runId);
  if (token && row.lock_token === token) run(db, 'UPDATE audit_runs SET lock_user_id = NULL, lock_name = NULL, lock_token = NULL, lock_heartbeat = NULL WHERE id = ?', row.id);
  return { ok: true };
}

export function updateStep(db: DB, ctx: Ctx, runId: string, stepId: string, body: unknown, token: string | null) {
  const row = loadRun(db, ctx, runId);
  requireLock(row, ctx, token);
  const template = JSON.parse(row.template) as AuditTemplate;
  const step = allSteps(template).find((s) => s.step.id === stepId)?.step;
  if (!step) throw notFound('Unknown step.');
  const c = cleanStepPatch(step, body);
  if (!c.ok) throw badRequest(c.error);
  return tx(db, () => {
    const cur = get<StepRow>(db, 'SELECT * FROM audit_steps WHERE run_id = ? AND step_id = ?', row.id, stepId);
    const prev: StepState = cur ? { done: !!cur.done, initials: cur.initials, note: cur.note, subs: JSON.parse(cur.subs) } : emptyState();
    const next: StepState = { ...prev, ...c.patch };
    // Completing a step stamps who and when; the initials default to the person's own.
    const completing = next.done && !prev.done;
    if (completing && !next.initials) next.initials = initialsOf(ctx.name).slice(0, 4);
    const doneAt = completing ? now() : next.done ? (cur?.done_at ?? now()) : null;
    const doneBy = completing ? ctx.name : next.done ? (cur?.done_by ?? ctx.name) : null;
    run(db, `INSERT INTO audit_steps (run_id, step_id, done, initials, note, subs, done_by, done_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT (run_id, step_id) DO UPDATE SET done = excluded.done, initials = excluded.initials, note = excluded.note, subs = excluded.subs,
               done_by = excluded.done_by, done_at = excluded.done_at, updated_at = excluded.updated_at`,
      row.id, stepId, next.done ? 1 : 0, next.initials, next.note, JSON.stringify(next.subs), doneBy, doneAt, now());
    run(db, 'UPDATE audit_runs SET lock_heartbeat = ? WHERE id = ?', now(), row.id);
    const states = statesOf(db, row.id);
    return { state: states[stepId]!, progress: computeProgress(template, states), rolled: isRolled(template, states) };
  });
}

export function updateMeta(db: DB, ctx: Ctx, runId: string, body: unknown, token: string | null) {
  const row = loadRun(db, ctx, runId);
  requireLock(row, ctx, token);
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['nightAuditor', 'nightManager'].includes(k)) throw badRequest(`Unknown field "${k}".`);
  const name = (v: unknown, f: string) => { if (typeof v !== 'string' || v.length > 80 || /[<>]/.test(v)) throw badRequest(`${f} must be a name up to 80 characters.`); return v.trim(); };
  const na = b.nightAuditor !== undefined ? name(b.nightAuditor, 'nightAuditor') : row.night_auditor;
  const nm = b.nightManager !== undefined ? name(b.nightManager, 'nightManager') : row.night_manager;
  run(db, 'UPDATE audit_runs SET night_auditor = ?, night_manager = ?, lock_heartbeat = ? WHERE id = ?', na, nm, now(), row.id);
  return { nightAuditor: na, nightManager: nm };
}

export function closeRun(db: DB, ctx: Ctx, runId: string, body: unknown, token: string | null) {
  const row = loadRun(db, ctx, runId);
  requireLock(row, ctx, token);
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const template = JSON.parse(row.template) as AuditTemplate;
  const p = computeProgress(template, statesOf(db, row.id));
  if (!row.night_auditor.trim()) throw badRequest('Enter the night auditor’s name before closing.');
  let note: string | null = null;
  if (p.done < p.total) {
    // Real shifts sometimes end with a step skipped; that is allowed, but it must be deliberate and explained.
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (b.acknowledgeIncomplete !== true || reason.length < 3) {
      throw new HttpError(409, 'incomplete', `${p.total - p.done} step(s) are not done. Give a reason to close anyway.`, { remaining: p.total - p.done });
    }
    note = reason.slice(0, 300);
  }
  run(db, `UPDATE audit_runs SET status = 'closed', closed_by = ?, closed_at = ?, close_note = ?, lock_user_id = NULL, lock_name = NULL, lock_token = NULL, lock_heartbeat = NULL WHERE id = ?`, ctx.name, now(), note, row.id);
  log(db, ctx, 'audit.close', JSON.stringify({ run: row.id, date: row.audit_date, incomplete: p.total - p.done }));
  return { ok: true, incomplete: p.total - p.done };
}

export function reopenRun(db: DB, ctx: Ctx, runId: string) {
  const row = loadRun(db, ctx, runId);
  if (!isAdminRole(ctx) || (ctx.role === 'property_admin' && ctx.propertyId !== row.property_id)) throw forbidden('Only an administrator can reopen a closed audit.');
  if (row.status !== 'closed') throw new HttpError(409, 'not_closed', 'This audit is not closed.');
  run(db, `UPDATE audit_runs SET status = 'open', closed_by = NULL, closed_at = NULL, close_note = NULL WHERE id = ?`, row.id);
  log(db, ctx, 'audit.reopen', JSON.stringify({ run: row.id, date: row.audit_date }));
  return { ok: true };
}

// ─────────────────────────── lists, overview, summary ───────────────────────────

export function listRuns(db: DB, ctx: Ctx, propertyId: unknown, limit = 30) {
  const prop = resolveProperty(db, ctx, propertyId);
  const rows = all<RunRow>(db, 'SELECT * FROM audit_runs WHERE property_id = ? AND company_id = ? ORDER BY audit_date DESC LIMIT ?', prop.id, ctx.companyId, Math.min(limit, 100));
  return rows.map((r) => {
    const t = JSON.parse(r.template) as AuditTemplate;
    const p = computeProgress(t, statesOf(db, r.id));
    return { id: r.id, auditDate: r.audit_date, status: r.status, nightAuditor: r.night_auditor, percent: p.percent, done: p.done, total: p.total, closedAt: r.closed_at, closeNote: r.close_note, heldBy: lockFresh(r) ? r.lock_name : null };
  });
}

/** Management view: where does each property stand for a given audit date? */
export function overview(db: DB, ctx: Ctx, date: unknown) {
  if (!isYmd(date)) throw badRequest('date must be a valid YYYY-MM-DD date.');
  return accessibleProperties(db, ctx).map((p) => {
    const r = get<RunRow>(db, 'SELECT * FROM audit_runs WHERE property_id = ? AND company_id = ? AND audit_date = ?', p.id, ctx.companyId, date);
    if (!r) return { propertyId: p.id, propertyName: p.name, status: 'not_started' as const, percent: 0, nightAuditor: '', heldBy: null as string | null };
    const percent = computeProgress(JSON.parse(r.template) as AuditTemplate, statesOf(db, r.id)).percent;
    return { propertyId: p.id, propertyName: p.name, status: r.status, percent, nightAuditor: r.night_auditor, heldBy: lockFresh(r) ? r.lock_name : null };
  });
}

export function summaryText(db: DB, ctx: Ctx, runId: string): string {
  const row = loadRun(db, ctx, runId);
  const cc = get<{ data: string }>(db, 'SELECT data FROM audit_ccrec WHERE run_id = ?', row.id);
  return buildSummary({
    propertyName: get<{ name: string }>(db, 'SELECT name FROM properties WHERE id = ?', row.property_id)!.name, auditDate: row.audit_date,
    nightAuditor: row.night_auditor, nightManager: row.night_manager, status: row.status, template: JSON.parse(row.template) as AuditTemplate,
    states: statesOf(db, row.id), fileCounts: fileCounts(db, row.id), ccrec: cc ? (JSON.parse(cc.data) as CcRecData) : null,
  });
}

// ─────────────────────────── card reconciliation ───────────────────────────

export function getCcRec(db: DB, ctx: Ctx, runId: string): CcRecData {
  const row = loadRun(db, ctx, runId);
  const r = get<{ data: string }>(db, 'SELECT data FROM audit_ccrec WHERE run_id = ?', row.id);
  return r ? (JSON.parse(r.data) as CcRecData) : emptyCcRec();
}

export function putCcRec(db: DB, ctx: Ctx, runId: string, body: unknown, token: string | null) {
  const row = loadRun(db, ctx, runId);
  requireLock(row, ctx, token);
  const v = validateCcRec(body);
  if (!v.ok) throw badRequest(v.error);
  run(db, `INSERT INTO audit_ccrec (run_id, data, updated_by, updated_at) VALUES (?,?,?,?)
           ON CONFLICT (run_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, row.id, JSON.stringify(v.data), ctx.name, now());
  run(db, 'UPDATE audit_runs SET lock_heartbeat = ? WHERE id = ?', now(), row.id);
  return { ok: true };
}

// ─────────────────────────── report files (7-day working papers) ───────────────────────────

function purgeExpired(db: DB) {
  run(db, 'DELETE FROM audit_files WHERE created_at < ?', new Date(Date.now() - FILE_RETENTION_DAYS * 86_400_000).toISOString());
}

export function listFiles(db: DB, ctx: Ctx, runId: string) {
  purgeExpired(db);
  const row = loadRun(db, ctx, runId);
  return all<{ id: string; step_id: string; name: string; mime: string; size: number; created_at: string; uploader: string | null }>(db,
    `SELECT f.id, f.step_id, f.name, f.mime, f.size, f.created_at, u.name AS uploader FROM audit_files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.run_id = ? AND f.company_id = ? ORDER BY f.created_at`, row.id, ctx.companyId)
    .map((f) => ({ id: f.id, stepId: f.step_id, name: f.name, mime: f.mime, size: f.size, uploadedBy: f.uploader, createdAt: f.created_at, expiresAt: new Date(Date.parse(f.created_at) + FILE_RETENTION_DAYS * 86_400_000).toISOString() }));
}

export function addFile(db: DB, ctx: Ctx, runId: string, stepId: string, rawName: string, bytes: Uint8Array, token: string | null) {
  const row = loadRun(db, ctx, runId);
  requireLock(row, ctx, token);
  if (!allSteps(JSON.parse(row.template) as AuditTemplate).some((s) => s.step.id === stepId)) throw notFound('Unknown step.');
  const { mime, ext } = sniffReport(bytes, rawName);
  const n = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM audit_files WHERE run_id = ?', row.id)!.n;
  if (n >= 60) throw new HttpError(413, 'too_many_files', 'This audit already has 60 files.');
  const id = randomUUID(), name = safeFileName(rawName, ext);
  run(db, 'INSERT INTO audit_files (id, company_id, run_id, step_id, name, mime, size, bytes, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, ctx.companyId, row.id, stepId, name, mime, bytes.length, bytes, ctx.userId, now());
  run(db, 'UPDATE audit_runs SET lock_heartbeat = ? WHERE id = ?', now(), row.id);
  return { id, name, mime, size: bytes.length };
}

/** Download. Scoped like the run it belongs to, so a file id from another tenant or property is a 404. */
export function getFile(db: DB, ctx: Ctx, fileId: string) {
  purgeExpired(db);
  assertView(ctx);
  const f = get<{ run_id: string; name: string; mime: string; bytes: Uint8Array }>(db, 'SELECT run_id, name, mime, bytes FROM audit_files WHERE id = ? AND company_id = ?', fileId, ctx.companyId);
  if (!f) throw notFound('File not found.');
  loadRun(db, ctx, f.run_id); // enforces the property scope
  return f;
}

export function deleteFile(db: DB, ctx: Ctx, fileId: string, token: string | null) {
  assertView(ctx);
  const f = get<{ run_id: string }>(db, 'SELECT run_id FROM audit_files WHERE id = ? AND company_id = ?', fileId, ctx.companyId);
  if (!f) throw notFound('File not found.');
  const row = loadRun(db, ctx, f.run_id);
  requireLock(row, ctx, token);
  run(db, 'DELETE FROM audit_files WHERE id = ?', fileId);
  return { ok: true };
}

// ─────────────────────────── who may use the module ───────────────────────────

/** People in the caller's scope and their night-audit access. Property administrators see their property; company administrators all. */
export function listAccess(db: DB, ctx: Ctx) {
  if (!isAdminRole(ctx)) throw forbidden('Only administrators can manage night-audit access.');
  const scope = ctx.role === 'company_admin' ? 'u.company_id = ?' : 'u.company_id = ? AND u.property_id = ?';
  const params = ctx.role === 'company_admin' ? [ctx.companyId] : [ctx.companyId, ctx.propertyId];
  return all<{ id: string; name: string; email: string; role: string; property: string | null; audit_access: string | null }>(db,
    `SELECT u.id, u.name, u.email, u.role, p.name AS property, u.audit_access FROM users u LEFT JOIN properties p ON p.id = u.property_id
      WHERE ${scope} AND u.property_id IS NOT NULL ORDER BY p.name, u.name`, ...params)
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, property: u.property, access: u.audit_access }));
}

export function setAccess(db: DB, ctx: Ctx, userId: string, access: unknown) {
  if (!isAdminRole(ctx)) throw forbidden('Only administrators can manage night-audit access.');
  if (access !== null && access !== 'auditor' && access !== 'manager' && access !== 'both') throw badRequest('access must be auditor, manager, both or null.');
  const u = get<{ id: string; property_id: string | null }>(db, 'SELECT id, property_id FROM users WHERE id = ? AND company_id = ?', userId, ctx.companyId);
  if (!u || (ctx.role === 'property_admin' && u.property_id !== ctx.propertyId)) throw notFound('User not found.');
  if (!u.property_id) throw badRequest('Night-audit roles belong to a property; this user has none.');
  run(db, 'UPDATE users SET audit_access = ? WHERE id = ? AND company_id = ?', access, userId, ctx.companyId);
  log(db, ctx, 'audit.access', JSON.stringify({ user: userId, access }));
  return { ok: true };
}
