import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Ctx, Env } from './auth.ts';
import { all, get, now, run, tx, type DB } from './db.ts';
import { HttpError, badRequest, forbidden, notFound } from './http.ts';
import { leaveScope } from './tenancy.ts';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export const LEAVE_TYPES = ['Annual leave', 'Sick leave', 'Unpaid leave', 'Parental leave', 'Time off in lieu'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Mon–Fri days between two ISO dates, inclusive. Pure and independent of any theme or tenant. */
export function countWorkingDays(start: string, end: string): number {
  let n = 0;
  for (let d = toDate(start); d <= toDate(end); d = new Date(d.getTime() + 86_400_000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

interface LeaveRow {
  id: string; company_id: string; property_id: string; department_id: string; employee_id: string; leave_type: string;
  start_date: string; end_date: string; days: number; status: LeaveStatus; reason: string | null;
  decided_by: string | null; decided_at: string | null; created_at: string;
  employee_name?: string; department_name?: string; property_name?: string; decider_name?: string | null;
}

const SELECT = `
  SELECT l.*, e.name AS employee_name, d.name AS department_name, p.name AS property_name, dec.name AS decider_name
    FROM leave_requests l
    JOIN users e ON e.id = l.employee_id
    JOIN departments d ON d.id = l.department_id
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN users dec ON dec.id = l.decided_by`;

const present = (r: LeaveRow, ctx: Ctx) => ({
  id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, department: r.department_name, property: r.property_name,
  type: r.leave_type, startDate: r.start_date, endDate: r.end_date, days: r.days, status: r.status, reason: r.reason,
  decidedBy: r.decider_name ?? null, decidedAt: r.decided_at, createdAt: r.created_at,
  canDecide: r.status === 'pending' && canDecide(ctx, r),
  canCancel: (r.status === 'pending' || r.status === 'approved') && (r.employee_id === ctx.userId || canDecide(ctx, r)),
});

/** Who may approve/reject: never your own request; managers within their department, property admins within their property. */
function canDecide(ctx: Ctx, r: Pick<LeaveRow, 'employee_id' | 'department_id' | 'property_id'>): boolean {
  if (r.employee_id === ctx.userId) return false;
  switch (ctx.role) {
    case 'company_admin': return true;
    case 'property_admin': return r.property_id === ctx.propertyId;
    case 'manager': return r.department_id === ctx.departmentId;
    default: return false;
  }
}

export function listLeave(db: DB, ctx: Ctx, q: { status?: string; from?: string; to?: string }) {
  const sc = leaveScope(ctx);
  const where = [sc.sql]; const params = [...sc.params];
  if (q.status) {
    if (!['pending', 'approved', 'rejected', 'cancelled'].includes(q.status)) throw badRequest('Unknown status.');
    where.push('l.status = ?'); params.push(q.status);
  }
  if (q.from) { if (!DATE.test(q.from)) throw badRequest('from must be YYYY-MM-DD.'); where.push('l.end_date >= ?'); params.push(q.from); }
  if (q.to) { if (!DATE.test(q.to)) throw badRequest('to must be YYYY-MM-DD.'); where.push('l.start_date <= ?'); params.push(q.to); }
  return all<LeaveRow>(db, `${SELECT} WHERE ${where.join(' AND ')} ORDER BY l.start_date DESC LIMIT 500`, ...params).map((r) => present(r, ctx));
}

function loadVisible(db: DB, ctx: Ctx, id: string): LeaveRow {
  const sc = leaveScope(ctx);
  // The tenant/role predicate is part of the lookup: another company's request is indistinguishable from a missing one.
  const row = get<LeaveRow>(db, `${SELECT} WHERE l.id = ? AND ${sc.sql}`, id, ...sc.params);
  if (!row) throw notFound('Leave request not found.');
  return row;
}

function notify(db: DB, companyId: string, userId: string, status: LeaveStatus, title: string, body: string) {
  run(db, 'INSERT INTO notifications (id, company_id, user_id, kind, status, title, body, created_at) VALUES (?,?,?,?,?,?,?,?)',
    randomUUID(), companyId, userId, 'leave', status, title, body, now());
}

export function createLeave(db: DB, ctx: Ctx, input: Record<string, unknown>) {
  const { type, startDate, endDate, reason } = input;
  if (typeof type !== 'string' || !(LEAVE_TYPES as readonly string[]).includes(type)) throw badRequest('Choose a leave type.');
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || !DATE.test(startDate) || !DATE.test(endDate)) throw badRequest('Dates must be YYYY-MM-DD.');
  if (endDate < startDate) throw badRequest('The end date cannot be before the start date.');
  const days = countWorkingDays(startDate, endDate);
  if (days === 0) throw badRequest('That range contains no working days.');
  if (days > 60) throw badRequest('Requests are limited to 60 working days.');
  const note = typeof reason === 'string' ? reason.trim().slice(0, 300) || null : null;

  const me = get<{ property_id: string | null; department_id: string | null }>(db, 'SELECT property_id, department_id FROM users WHERE id = ? AND company_id = ?', ctx.userId, ctx.companyId);
  if (!me?.property_id || !me.department_id) throw badRequest('Only employees assigned to a property and department can request leave.');

  return tx(db, () => {
    const clash = get(db, `SELECT 1 FROM leave_requests WHERE company_id = ? AND employee_id = ? AND status IN ('pending','approved')
                           AND start_date <= ? AND end_date >= ?`, ctx.companyId, ctx.userId, endDate, startDate);
    if (clash) throw new HttpError(409, 'overlap', 'You already have leave that overlaps these dates.');
    const id = randomUUID();
    run(db, `INSERT INTO leave_requests (id, company_id, property_id, department_id, employee_id, leave_type, start_date, end_date, days, status, reason, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`, id, ctx.companyId, me.property_id, me.department_id, ctx.userId, type, startDate, endDate, days, note, now());
    for (const m of all<{ id: string }>(db, `SELECT id FROM users WHERE company_id = ? AND id != ? AND ((role = 'manager' AND department_id = ?) OR (role = 'property_admin' AND property_id = ?))`,
      ctx.companyId, ctx.userId, me.department_id, me.property_id)) {
      notify(db, ctx.companyId, m.id, 'pending', 'Leave request awaiting approval', `${ctx.name} requested ${days} working day${days === 1 ? '' : 's'} of ${type.toLowerCase()} (${startDate} → ${endDate}).`);
    }
    return present(loadVisible(db, ctx, id), ctx);
  });
}

export function decideLeave(db: DB, ctx: Ctx, id: string, decision: unknown) {
  if (decision !== 'approved' && decision !== 'rejected') throw badRequest('decision must be "approved" or "rejected".');
  return tx(db, () => {
    const r = loadVisible(db, ctx, id);
    if (!canDecide(ctx, r)) throw forbidden(r.employee_id === ctx.userId ? 'You cannot decide your own leave request.' : 'You cannot decide this request.');
    if (r.status !== 'pending') throw new HttpError(409, 'not_pending', 'Only pending requests can be decided.');
    run(db, 'UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND company_id = ?', decision, ctx.userId, now(), id, ctx.companyId);
    notify(db, ctx.companyId, r.employee_id, decision, decision === 'approved' ? 'Leave approved' : 'Leave rejected',
      `Your ${r.leave_type.toLowerCase()} request (${r.start_date} → ${r.end_date}) was ${decision} by ${ctx.name}.`);
    return present(loadVisible(db, ctx, id), ctx);
  });
}

export function cancelLeave(db: DB, ctx: Ctx, id: string) {
  return tx(db, () => {
    const r = loadVisible(db, ctx, id);
    if (r.employee_id !== ctx.userId && !canDecide(ctx, r)) throw forbidden('You cannot cancel this request.');
    if (r.status !== 'pending' && r.status !== 'approved') throw new HttpError(409, 'not_cancellable', 'Only pending or approved requests can be cancelled.');
    run(db, 'UPDATE leave_requests SET status = ? WHERE id = ? AND company_id = ?', 'cancelled', id, ctx.companyId);
    if (r.employee_id !== ctx.userId) notify(db, ctx.companyId, r.employee_id, 'cancelled', 'Leave cancelled', `Your ${r.leave_type.toLowerCase()} request (${r.start_date} → ${r.end_date}) was cancelled by ${ctx.name}.`);
    return present(loadVisible(db, ctx, id), ctx);
  });
}

export const leaveRoutes = new Hono<Env>();
leaveRoutes.get('/', (c) => c.json({ leave: listLeave(c.get('db'), c.get('ctx'), { status: c.req.query('status'), from: c.req.query('from'), to: c.req.query('to') }) }));
leaveRoutes.post('/', async (c) => c.json(createLeave(c.get('db'), c.get('ctx'), await c.req.json().catch(() => ({}))), 201));
leaveRoutes.post('/:id/decision', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json(decideLeave(c.get('db'), c.get('ctx'), c.req.param('id'), body.decision));
});
leaveRoutes.post('/:id/cancel', (c) => c.json(cancelLeave(c.get('db'), c.get('ctx'), c.req.param('id'))));
