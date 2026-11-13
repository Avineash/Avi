import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { get, run, now, type DB } from './db.ts';
import { HttpError } from './http.ts';

export type Role = 'employee' | 'manager' | 'property_admin' | 'company_admin';

/** Everything a request is allowed to know about "who" and "where". Derived from the session, never from input. */
export interface Ctx {
  userId: string;
  companyId: string;
  propertyId: string | null;
  departmentId: string | null;
  role: Role;
  name: string;
  email: string;
}
export type Env = { Variables: { ctx: Ctx; db: DB } };

export const COOKIE = 'sh_session';
const SESSION_DAYS = 7;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const key = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${key}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(key, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: string): { token: string; expires: Date } {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  run(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', sha(token), userId, now(), expires.toISOString());
  return { token, expires };
}

export function setSessionCookie(c: Context, token: string, expires: Date) {
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', path: '/', expires,
    secure: process.env.COOKIE_SECURE === '1' || c.req.header('x-forwarded-proto') === 'https',
  });
}
export const clearSessionCookie = (c: Context) => deleteCookie(c, COOKIE, { path: '/' });

export function destroySession(db: DB, token: string | undefined) {
  if (token) run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

interface SessionRow { id: string; company_id: string; property_id: string | null; department_id: string | null; role: Role; name: string; email: string }

/** Authenticates the cookie and attaches the tenant context. Also enforces a CSRF header on state-changing requests. */
export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-requested-with') !== 'staffhub') {
    throw new HttpError(403, 'csrf', 'Missing X-Requested-With header.');
  }
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  const db = c.get('db');
  const row = get<SessionRow>(db,
    `SELECT u.id, u.company_id, u.property_id, u.department_id, u.role, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`, sha(token), now());
  if (!row) { clearSessionCookie(c); throw new HttpError(401, 'unauthenticated', 'Your session has expired.'); }
  c.set('ctx', {
    userId: row.id, companyId: row.company_id, propertyId: row.property_id, departmentId: row.department_id,
    role: row.role, name: row.name, email: row.email,
  });
  await next();
};

/** Simple in-memory limiter for the login endpoint (per email + IP). */
const attempts = new Map<string, { n: number; reset: number }>();
export function throttleLogin(key: string) {
  const t = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.reset < t) { attempts.set(key, { n: 1, reset: t + 15 * 60_000 }); return; }
  cur.n += 1;
  if (cur.n > 8) throw new HttpError(429, 'too_many_attempts', 'Too many sign-in attempts. Try again in a few minutes.');
}
export const clearThrottle = (key: string) => attempts.delete(key);
