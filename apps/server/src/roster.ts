import { Hono } from 'hono';
import type { Ctx, Env } from './auth.ts';
import { all, get, type DB } from './db.ts';
import { badRequest, notFound } from './http.ts';
import { employeeScope, rosterScope, leaveScope } from './tenancy.ts';
import { isoDate } from './leave.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoDate(d);
}

/** Paid hours for a shift; handles overnight shifts. Pure: no dependence on theme or tenant. */
export function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

export function getRoster(db: DB, ctx: Ctx, q: { weekStart?: string; propertyId?: string }) {
  const start = q.weekStart ?? mondayOf(new Date());
  if (!DATE.test(start)) throw badRequest('weekStart must be YYYY-MM-DD.');
  const end = isoDate(new Date(new Date(`${start}T00:00:00Z`).getTime() + 6 * 86_400_000));

  const sc = rosterScope(ctx, 's');
  const where = [sc.sql, 's.shift_date BETWEEN ? AND ?']; const params: unknown[] = [...sc.params, start, end];
  if (q.propertyId) {
    // Optional property filter (company admins). Validated against the caller's own company before use.
    const p = get(db, 'SELECT 1 FROM properties WHERE id = ? AND company_id = ?', q.propertyId, ctx.companyId);
    if (!p) throw notFound('Property not found.');
    where.push('s.property_id = ?'); params.push(q.propertyId);
  }
  const shifts = all<{ id: string; employee_id: string; employee_name: string; department: string; property: string; shift_date: string; start_time: string; end_time: string; label: string }>(db,
    `SELECT s.id, s.employee_id, e.name AS employee_name, d.name AS department, p.name AS property, s.shift_date, s.start_time, s.end_time, s.label
       FROM roster_shifts s JOIN users e ON e.id = s.employee_id JOIN departments d ON d.id = s.department_id JOIN properties p ON p.id = s.property_id
      WHERE ${where.join(' AND ')} ORDER BY p.name, d.name, e.name, s.shift_date`, ...params);

  // Approved/pending leave overlapping this week for the people on the roster, so the grid can show it inline.
  const ls = leaveScope(ctx, 'l');
  const leave = all<{ employee_id: string; start_date: string; end_date: string; status: string }>(db,
    `SELECT l.employee_id, l.start_date, l.end_date, l.status FROM leave_requests l
      WHERE ${ls.sql} AND l.status IN ('approved','pending') AND l.start_date <= ? AND l.end_date >= ?`, ...ls.params, end, start);

  // Everyone who *can* appear on this roster (so people with no shifts still get a row).
  const es = employeeScope(ctx, 'u');
  const people = ctx.role === 'company_admin' || ctx.role === 'property_admin'
    ? all<{ id: string; name: string; department: string; property: string }>(db,
        `SELECT u.id, u.name, d.name AS department, p.name AS property FROM users u JOIN departments d ON d.id = u.department_id JOIN properties p ON p.id = u.property_id
          WHERE ${es.sql} ${q.propertyId ? 'AND u.property_id = ?' : ''} ORDER BY p.name, d.name, u.name`, ...es.params, ...(q.propertyId ? [q.propertyId] : []))
    : all<{ id: string; name: string; department: string; property: string }>(db,
        `SELECT u.id, u.name, d.name AS department, p.name AS property FROM users u JOIN departments d ON d.id = u.department_id JOIN properties p ON p.id = u.property_id
          WHERE u.company_id = ? AND u.department_id = ? ORDER BY u.name`, ctx.companyId, ctx.departmentId);

  const totalHours = shifts.reduce((n, s) => n + shiftHours(s.start_time, s.end_time), 0);
  return {
    weekStart: start, weekEnd: end, totalHours,
    people: people.map((p) => ({ id: p.id, name: p.name, property: p.property, department: ctx.role === 'company_admin' ? `${p.property} · ${p.department}` : p.department })),
    shifts: shifts.map((s) => ({ id: s.id, employeeId: s.employee_id, date: s.shift_date, start: s.start_time, end: s.end_time, label: s.label, hours: shiftHours(s.start_time, s.end_time) })),
    leave: leave.map((l) => ({ employeeId: l.employee_id, startDate: l.start_date, endDate: l.end_date, status: l.status })),
  };
}

export const rosterRoutes = new Hono<Env>();
rosterRoutes.get('/', (c) => c.json(getRoster(c.get('db'), c.get('ctx'), { weekStart: c.req.query('weekStart'), propertyId: c.req.query('propertyId') })));
