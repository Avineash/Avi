import { Hono } from 'hono';
import type { Ctx, Env } from './auth.ts';
import { all, get, now, run, type DB } from './db.ts';
import { notFound } from './http.ts';
import { isoDate } from './leave.ts';
import { employeeScope, leaveScope } from './tenancy.ts';

// ───────── notifications (always the caller's own, inside their company) ─────────

export const notificationRoutes = new Hono<Env>();
notificationRoutes.get('/', (c) => {
  const ctx = c.get('ctx');
  const rows = all<{ id: string; kind: string; status: string | null; title: string; body: string; created_at: string; read_at: string | null }>(c.get('db'),
    'SELECT id, kind, status, title, body, created_at, read_at FROM notifications WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100', ctx.companyId, ctx.userId);
  return c.json({ notifications: rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, title: r.title, body: r.body, createdAt: r.created_at, read: !!r.read_at })) });
});
notificationRoutes.post('/read-all', (c) => {
  const ctx = c.get('ctx');
  run(c.get('db'), 'UPDATE notifications SET read_at = ? WHERE company_id = ? AND user_id = ? AND read_at IS NULL', now(), ctx.companyId, ctx.userId);
  return c.json({ ok: true });
});
notificationRoutes.post('/:id/read', (c) => {
  const ctx = c.get('ctx');
  const r = run(c.get('db'), 'UPDATE notifications SET read_at = ? WHERE id = ? AND company_id = ? AND user_id = ?', now(), c.req.param('id'), ctx.companyId, ctx.userId);
  if (!r.changes) throw notFound('Notification not found.');
  return c.json({ ok: true });
});

// ───────── employees directory ─────────

export const employeeRoutes = new Hono<Env>();
employeeRoutes.get('/', (c) => {
  const ctx = c.get('ctx');
  const sc = employeeScope(ctx, 'u');
  const rows = all<{ id: string; name: string; email: string; role: string; department: string | null; property: string | null }>(c.get('db'),
    `SELECT u.id, u.name, u.email, u.role, d.name AS department, p.name AS property FROM users u
       LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN properties p ON p.id = u.property_id
      WHERE ${sc.sql} ORDER BY u.name`, ...sc.params);
  return c.json({ employees: rows });
});

// ───────── dashboard ─────────

export function dashboardSummary(db: DB, ctx: Ctx) {
  const ls = leaveScope(ctx, 'l');
  const today = isoDate(new Date());

  const byStatus = Object.fromEntries(['approved', 'pending', 'rejected', 'cancelled'].map((s) => [s, 0])) as Record<string, number>;
  for (const r of all<{ status: string; n: number }>(db, `SELECT l.status, COUNT(*) AS n FROM leave_requests l WHERE ${ls.sql} GROUP BY l.status`, ...ls.params)) byStatus[r.status] = r.n;

  // Working days of leave per month, next six months (pending + approved), split by status.
  const first = new Date(); first.setUTCDate(1);
  const months: Array<{ month: string; approved: number; pending: number }> = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    months.push({ month: d.toISOString().slice(0, 7), approved: 0, pending: 0 });
  }
  const rows = all<{ status: string; start_date: string; days: number }>(db,
    `SELECT l.status, l.start_date, l.days FROM leave_requests l WHERE ${ls.sql} AND l.status IN ('approved','pending') AND l.start_date >= ?`, ...ls.params, `${months[0]!.month}-01`);
  for (const r of rows) {
    const m = months.find((x) => x.month === r.start_date.slice(0, 7));
    if (m) (m as Record<string, number | string>)[r.status] = (m[r.status as 'approved' | 'pending'] ?? 0) + r.days;
  }

  const upcoming = all<{ id: string; employee_name: string; leave_type: string; start_date: string; end_date: string; status: string; days: number }>(db,
    `SELECT l.id, e.name AS employee_name, l.leave_type, l.start_date, l.end_date, l.status, l.days FROM leave_requests l JOIN users e ON e.id = l.employee_id
      WHERE ${ls.sql} AND l.status IN ('approved','pending') AND l.end_date >= ? ORDER BY l.start_date LIMIT 6`, ...ls.params, today)
    .map((r) => ({ id: r.id, employeeName: r.employee_name, type: r.leave_type, startDate: r.start_date, endDate: r.end_date, status: r.status, days: r.days }));

  const onLeaveToday = get<{ n: number }>(db, `SELECT COUNT(DISTINCT l.employee_id) AS n FROM leave_requests l WHERE ${ls.sql} AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?`, ...ls.params, today, today)!.n;
  const es = employeeScope(ctx, 'u');
  const headcount = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM users u WHERE ${es.sql}`, ...es.params)!.n;
  const unread = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM notifications WHERE company_id = ? AND user_id = ? AND read_at IS NULL', ctx.companyId, ctx.userId)!.n;

  return { byStatus, months, upcoming, onLeaveToday, headcount, unreadNotifications: unread };
}

export const dashboardRoutes = new Hono<Env>();
dashboardRoutes.get('/', (c) => c.json(dashboardSummary(c.get('db'), c.get('ctx'))));

