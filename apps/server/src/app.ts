import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import {
  clearSessionCookie, clearThrottle, COOKIE, createSession, destroySession, hashPassword, requireAuth, setSessionCookie,
  throttleLogin, verifyPassword, type Env,
} from './auth.ts';
import { auditRoutes } from './audit/routes.ts';
import { hasAuditModule } from './audit/store.ts';
import { brandRoutes } from './brand/routes.ts';
import { getAsset, publishedTheme } from './brand/store.ts';
import { all, get, run, type DB } from './db.ts';
import { HttpError, badRequest, notFound } from './http.ts';
import { leaveRoutes } from './leave.ts';
import { dashboardRoutes, employeeRoutes, notificationRoutes } from './misc.ts';
import { rosterRoutes } from './roster.ts';

export interface AppOptions { db: DB; demo?: boolean }

const DUMMY_HASH = hashPassword('not-a-real-password', '00'.repeat(16)); // equalises timing for unknown emails

function themeResponse(c: import('hono').Context, t: ReturnType<typeof publishedTheme>) {
  const etag = `"${t.fingerprint}"`;
  c.header('ETag', etag);
  c.header('Cache-Control', 'private, no-cache'); // always revalidate, so a publish is visible on the next load
  if (c.req.header('if-none-match') === etag) return c.body(null, 304);
  return c.json(t);
}

export function createApp({ db, demo = false }: AppOptions) {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.use('/api/*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));
  // Large bodies are only legitimate for image upload; everything else is small JSON.
  app.use('/api/brand/assets', bodyLimit({ maxSize: 600 * 1024, onError: (c) => c.json({ error: { code: 'file_too_large', message: 'File too large.' } }, 413) }));
  app.use('/api/audit/run/*', async (c, next) => {
    if (c.req.method === 'POST' && c.req.path.endsWith('/files')) {
      return bodyLimit({ maxSize: 5 * 1024 * 1024 + 4096, onError: (c2) => c2.json({ error: { code: 'file_too_large', message: 'Files are limited to 5 MB.' } }, 413) })(c, next);
    }
    await next();
  });
  app.use('/api/*', async (c, next) => {
    const upload = c.req.path === '/api/brand/assets' || (c.req.method === 'POST' && /^\/api\/audit\/run\/[^/]+\/files$/.test(c.req.path));
    if (!upload) {
      return bodyLimit({ maxSize: 128 * 1024, onError: (c2) => c2.json({ error: { code: 'too_large', message: 'Request too large.' } }, 413) })(c, next);
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong.' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ───────── public (no session) ─────────

  // Brand imagery. IDs are random UUIDs; the response can never execute anything even if an SVG slipped through.
  app.get('/api/assets/:id', (c) => {
    const a = getAsset(db, c.req.param('id'));
    if (!a) throw notFound();
    c.header('Content-Type', a.mime);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    c.header('Cache-Control', 'public, max-age=31536000, immutable'); // content-addressed by upload; a new logo is a new id
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    return c.body(a.bytes as unknown as ArrayBuffer);
  });

  /** Published branding for the sign-in page: `/api/public/brand?company=aurora&property=harbour`. Published data only. */
  app.get('/api/public/brand', (c) => {
    const slug = c.req.query('company');
    if (!slug) throw badRequest('company is required.');
    const company = get<{ id: string }>(db, 'SELECT id FROM companies WHERE slug = ?', slug);
    if (!company) throw notFound('Unknown company.');
    let propertyId: string | null = null;
    const pslug = c.req.query('property');
    if (pslug) {
      propertyId = get<{ id: string }>(db, 'SELECT id FROM properties WHERE company_id = ? AND slug = ?', company.id, pslug)?.id ?? null;
      if (!propertyId) throw notFound('Unknown property.');
    }
    return themeResponse(c, publishedTheme(db, company.id, propertyId));
  });

  app.get('/api/public/demo-accounts', (c) => {
    if (!demo) throw notFound();
    const rows = all(db, `
      SELECT u.email, u.name, u.role, u.audit_access AS auditAccess, c.name AS company, c.slug AS companySlug, p.name AS property
        FROM users u JOIN companies c ON c.id = u.company_id LEFT JOIN properties p ON p.id = u.property_id
       WHERE u.id IN (
         SELECT MIN(id) FROM users WHERE role IN ('company_admin','property_admin','manager','employee') AND audit_access IS NULL GROUP BY company_id, role)
          OR u.id IN (SELECT MIN(id) FROM users WHERE audit_access IS NOT NULL GROUP BY company_id, audit_access)
       ORDER BY c.name, CASE u.role WHEN 'company_admin' THEN 1 WHEN 'property_admin' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END`);
    return c.json({ password: 'staffhub-demo', accounts: rows });
  });

  // ───────── auth ─────────

  app.post('/api/auth/login', async (c) => {
    if (c.req.header('x-requested-with') !== 'staffhub') throw new HttpError(403, 'csrf', 'Missing X-Requested-With header.');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw badRequest('Enter your email and password.');
    const key = `${email}|${c.req.header('x-forwarded-for') ?? 'local'}`;
    throttleLogin(key);
    const user = get<{ id: string; password_hash: string }>(db, 'SELECT id, password_hash FROM users WHERE lower(email) = ?', email);
    const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && !!user;
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
    clearThrottle(key);
    const s = createSession(db, user!.id);
    setSessionCookie(c, s.token, s.expires);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    destroySession(db, getCookie(c, COOKIE));
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // ───────── authenticated ─────────

  const api = new Hono<Env>();
  api.use('*', requireAuth);

  api.get('/me', (c) => {
    const ctx = c.get('ctx');
    const user = get<{ appearance_pref: string | null }>(db, 'SELECT appearance_pref FROM users WHERE id = ? AND company_id = ?', ctx.userId, ctx.companyId)!;
    const company = get(db, 'SELECT id, name, slug FROM companies WHERE id = ?', ctx.companyId)!;
    const property = ctx.propertyId ? get(db, 'SELECT id, name, slug FROM properties WHERE id = ? AND company_id = ?', ctx.propertyId, ctx.companyId) ?? null : null;
    const department = ctx.departmentId ? get(db, 'SELECT id, name FROM departments WHERE id = ? AND company_id = ?', ctx.departmentId, ctx.companyId) ?? null : null;
    return c.json({
      user: { id: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role, appearancePref: user.appearance_pref },
      company, property, department,
      permissions: {
        manageBrand: ctx.role === 'company_admin' || ctx.role === 'property_admin',
        approveLeave: ctx.role !== 'employee',
        nightAudit: hasAuditModule(ctx),
        nightAuditRole: ctx.auditAccess,
      },
      theme: publishedTheme(db, ctx.companyId, ctx.propertyId),
    });
  });

  /** The theme for the caller's own company/property. Cheap to poll; supports ETag. */
  api.get('/theme', (c) => {
    const ctx = c.get('ctx');
    return themeResponse(c, publishedTheme(db, ctx.companyId, ctx.propertyId));
  });

  api.patch('/me/preferences', async (c) => {
    const ctx = c.get('ctx');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = body.appearance;
    if (v !== null && v !== 'light' && v !== 'dark' && v !== 'system') throw badRequest('appearance must be light, dark, system or null.');
    run(db, 'UPDATE users SET appearance_pref = ? WHERE id = ? AND company_id = ?', v, ctx.userId, ctx.companyId);
    return c.json({ ok: true });
  });

  api.route('/leave', leaveRoutes);
  api.route('/roster', rosterRoutes);
  api.route('/notifications', notificationRoutes);
  api.route('/employees', employeeRoutes);
  api.route('/dashboard', dashboardRoutes);
  api.route('/brand', brandRoutes);
  api.route('/audit', auditRoutes);
  app.route('/api', api);

  return app;
}
