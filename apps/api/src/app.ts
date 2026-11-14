import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError, makeGuard } from './auth.js';
import { PaymentService } from './payments/service.js';
import { buildRegistry } from './payments/registry.js';
import { PricingError } from './pricing.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { restaurantRoutes } from './routes/restaurant.js';
import { adminRoutes } from './routes/admin.js';

declare module 'fastify' { interface FastifyRequest { rawBody?: string } }

export interface AppCtx {
  app: FastifyInstance; db: Db; cfg: Config; svc: PaymentService;
  guard: ReturnType<typeof makeGuard>;
}

export async function buildApp(cfg: Config, db: Db): Promise<AppCtx> {
  const app = Fastify({
    logger: cfg.env === 'test' || cfg.logLevel === 'silent' ? false : { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true, bodyLimit: 1_000_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false });  // API serves JSON/SVG only; CSP is set by the web tier
  await app.register(cookie);
  // NODE_ENV=test is rejected as a production value by config, so this exemption cannot exist in production.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: () => cfg.env === 'test' });
  mkdirSync(resolve(cfg.uploadDir), { recursive: true });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

  // Keep the exact bytes: webhook signatures are computed over the raw body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch { done(new HttpError(400, 'bad_json', 'Invalid JSON')); }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, ...err.extra });
    if (err instanceof PricingError) return reply.status(422).send({ error: err.code, message: err.message, itemId: err.itemId });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'validation', message: 'Invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    if (err.code === '23505') return reply.status(409).send({ error: 'conflict', message: 'Already exists' });
    req.log.error({ err }, 'unhandled');
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Not found' }));

  const svc = new PaymentService(db, cfg, buildRegistry(db, cfg));
  const guard = makeGuard(cfg, db);
  const ctx: AppCtx = { app, db, cfg, svc, guard };

  app.get('/api/health', async () => ({ ok: true, db: db.kind, sandbox: cfg.allowSandbox }));
  await authRoutes(ctx);
  await publicRoutes(ctx);
  await webhookRoutes(ctx);
  await restaurantRoutes(ctx);
  await adminRoutes(ctx);
  if (cfg.allowSandbox) await sandboxRoutes(ctx);
  return ctx;
}
