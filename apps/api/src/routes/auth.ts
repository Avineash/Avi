import { z } from 'zod';
import type { AppCtx } from '../app.js';
import { COOKIE, HttpError, cookieOpts, signSession, ROLE_PERMS } from '../auth.js';
import { SYSTEM } from '../db.js';
import { fakeVerify, hashPassword, verifyPassword, token } from '../crypto.js';
import { audit } from '../audit.js';

const MAX_FAILS = 5, LOCK_MIN = 15;
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export async function authRoutes({ app, db, cfg, guard }: AppCtx) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const u = await db.tx(SYSTEM, (q) => q.one(
      `select u.*, r.status as rstatus from users u left join restaurants r on r.id = u.restaurant_id where lower(u.email) = lower($1)`, [b.email]));
    const fail = () => new HttpError(401, 'invalid_credentials', 'Incorrect email or password');
    if (!u) { fakeVerify(); throw fail(); }
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(429, 'locked', 'Too many attempts. Try again later.');
    const ok = u.active && (await verifyPassword(b.password, u.password_hash));
    if (!ok) {
      await db.tx(SYSTEM, async (q) => {
        await q.query(`update users set failed_attempts = failed_attempts + 1,
          locked_until = case when failed_attempts + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end where id = $1`, [u.id, MAX_FAILS, String(LOCK_MIN)]);
        await audit(q, u.restaurant_id, { id: u.id, role: u.role, ip: req.ip }, 'login.failed', 'user', u.id);
      });
      throw fail();
    }
    if (u.restaurant_id && u.rstatus === 'pending') throw new HttpError(403, 'pending_approval', 'Your restaurant is awaiting approval by TableFlow');
    if (u.restaurant_id && u.rstatus !== 'active') throw new HttpError(403, 'restaurant_inactive', `Restaurant is ${u.rstatus}`);
    await db.tx(SYSTEM, async (q) => {
      await q.query(`update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1`, [u.id]);
      await audit(q, u.restaurant_id, { id: u.id, role: u.role, ip: req.ip }, 'login.ok', 'user', u.id);
    });
    reply.setCookie(COOKIE, await signSession(cfg, u.id), cookieOpts(cfg));
    return { id: u.id, name: u.name, role: u.role, restaurantId: u.restaurant_id, perms: ROLE_PERMS[u.role as keyof typeof ROLE_PERMS] };
  });

  app.post('/api/auth/logout', async (_req, reply) => { reply.clearCookie(COOKIE, { path: '/' }); return { ok: true }; });

  app.get('/api/auth/me', { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    return { id: a.userId, name: a.name, email: a.email, role: a.role, restaurantId: a.restaurantId, restaurantName: a.restaurantName, perms: a.perms, sandbox: cfg.allowSandbox };
  });

  app.post('/api/auth/change-password', { preHandler: guard() }, async (req) => {
    const b = z.object({ current: z.string(), next: z.string().min(10).max(200) }).parse(req.body);
    const u = await db.tx(SYSTEM, (q) => q.one(`select password_hash from users where id = $1`, [req.auth!.userId]));
    if (!(await verifyPassword(b.current, u.password_hash))) throw new HttpError(403, 'invalid_credentials', 'Current password is incorrect');
    await db.tx(SYSTEM, async (q) => {
      await q.query(`update users set password_hash = $2 where id = $1`, [req.auth!.userId, await hashPassword(b.next)]);
      await audit(q, req.auth!.restaurantId, { id: req.auth!.userId, role: req.auth!.role, ip: req.ip }, 'password.changed', 'user', req.auth!.userId);
    });
    return { ok: true };
  });

  // Self-service onboarding. The restaurant stays 'pending' until a platform admin approves it.
  app.post('/api/auth/register-restaurant', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const b = z.object({
      restaurantName: z.string().trim().min(2).max(80), city: z.string().trim().max(60).default('Colombo'),
      phone: z.string().trim().max(30).optional(), ownerName: z.string().trim().min(2).max(80),
      email: z.string().email().max(120), password: z.string().min(10).max(200),
    }).parse(req.body);
    const base = slugify(b.restaurantName) || 'restaurant';
    return db.tx(SYSTEM, async (q) => {
      if (await q.one(`select 1 from users where lower(email) = lower($1)`, [b.email])) throw new HttpError(409, 'email_taken', 'That email is already registered');
      const slug = (await q.one(`select 1 from restaurants where slug = $1`, [base])) ? `${base}-${token(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}` : base;
      const r = await q.one(`insert into restaurants (slug, name, email, phone, city, status, plan_id) values ($1,$2,$3,$4,$5,'pending','starter') returning id, slug`,
        [slug, b.restaurantName, b.email, b.phone ?? null, b.city]);
      const u = await q.one(`insert into users (restaurant_id, email, name, role, password_hash) values ($1,$2,$3,'owner',$4) returning id`,
        [r.id, b.email, b.ownerName, await hashPassword(b.password)]);
      await audit(q, r.id, { id: u.id, role: 'owner', ip: req.ip }, 'restaurant.registered', 'restaurant', r.id);
      return { ok: true, restaurantId: r.id, slug: r.slug, status: 'pending' };
    });
  });
}
