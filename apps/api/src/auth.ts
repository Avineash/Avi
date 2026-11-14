import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { SYSTEM, tenant, type Db, type Scope } from './db.js';

export type Role = 'owner' | 'manager' | 'kitchen' | 'cashier' | 'platform_admin' | 'platform_support';
export type Perm =
  | 'orders:read' | 'orders:update' | 'menu:write' | 'tables:write' | 'payments:read' | 'refunds:create'
  | 'reports:read' | 'staff:manage' | 'settings:write' | 'feedback:read' | 'support:write'
  | 'platform:read' | 'platform:write' | 'platform:tickets';

const RESTAURANT_ALL: Perm[] = ['orders:read', 'orders:update', 'menu:write', 'tables:write', 'payments:read',
  'refunds:create', 'reports:read', 'staff:manage', 'settings:write', 'feedback:read', 'support:write'];

export const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: RESTAURANT_ALL,
  manager: RESTAURANT_ALL.filter((p) => p !== 'staff:manage' && p !== 'settings:write'),
  cashier: ['orders:read', 'orders:update', 'payments:read', 'feedback:read'],
  kitchen: ['orders:read', 'orders:update'],
  platform_admin: ['platform:read', 'platform:write', 'platform:tickets'],
  platform_support: ['platform:read', 'platform:tickets'],
};

export interface AuthCtx {
  userId: string; name: string; email: string; role: Role;
  restaurantId: string | null; restaurantName?: string; perms: Perm[]; ip: string;
}
declare module 'fastify' { interface FastifyRequest { auth?: AuthCtx } }

export const COOKIE = 'tf_session';
const TTL_HOURS = 12;

export async function signSession(cfg: Config, userId: string) {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${TTL_HOURS}h`).setIssuer('tableflow').sign(cfg.jwtSecret);
}
export const cookieOpts = (cfg: Config) => ({
  httpOnly: true, secure: cfg.cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: TTL_HOURS * 3600,
});

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public extra?: object) { super(message ?? code); }
}

/** Builds the preHandler guard. Re-checks the user and tenant status on EVERY request, so
 *  deactivating a user or suspending a restaurant takes effect immediately. */
export function makeGuard(cfg: Config, db: Db) {
  return (...need: Perm[]) => async (req: FastifyRequest, _reply: FastifyReply) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookie = (req.cookies as any)?.[COOKIE] as string | undefined;
    const tok = bearer ?? cookie;
    if (!tok) throw new HttpError(401, 'unauthenticated', 'Please sign in');
    // CSRF: cookie-authenticated mutations must carry a custom header (cannot be sent cross-site without CORS).
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-tf-csrf'] !== '1')
      throw new HttpError(403, 'csrf', 'Missing CSRF header');
    let sub: string;
    try { sub = (await jwtVerify(tok, cfg.jwtSecret, { issuer: 'tableflow' })).payload.sub!; }
    catch { throw new HttpError(401, 'unauthenticated', 'Session expired'); }
    const u = await db.tx(SYSTEM, (q) => q.one(
      `select u.id, u.name, u.email, u.role, u.active, u.restaurant_id, r.name as rname, r.status as rstatus
         from users u left join restaurants r on r.id = u.restaurant_id where u.id = $1`, [sub]));
    if (!u || !u.active) throw new HttpError(401, 'unauthenticated', 'Account disabled');
    if (u.restaurant_id && u.rstatus !== 'active')
      throw new HttpError(403, 'restaurant_inactive', `Restaurant is ${u.rstatus}`);
    const perms = ROLE_PERMS[u.role as Role];
    for (const p of need) if (!perms.includes(p)) throw new HttpError(403, 'forbidden', `Missing permission ${p}`);
    req.auth = { userId: u.id, name: u.name, email: u.email, role: u.role, restaurantId: u.restaurant_id,
      restaurantName: u.rname, perms, ip: req.ip };
  };
}

export const scopeOf = (a: AuthCtx): Scope => (a.restaurantId ? tenant(a.restaurantId) : SYSTEM);
export const actorOf = (a: AuthCtx) => ({ id: a.userId, role: a.role, ip: a.ip });
