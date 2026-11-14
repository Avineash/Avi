import { z } from 'zod';
import { createHash } from 'node:crypto';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** Postgres connection string. If unset (dev/test only) an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./data/pgdata'),
  JWT_SECRET: z.string().optional(),
  /** 32-byte key, base64. Encrypts payment-provider credentials at rest. */
  SECRETS_KEY: z.string().optional(),
  /** Public origin of the customer-facing web app. QR codes encode URLs under this origin. */
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  /** Sandbox (simulated) payment providers. Forced OFF in production unless explicitly enabled. */
  ALLOW_SANDBOX: bool.optional(),
  COOKIE_SECURE: bool.optional(),
  LOG_LEVEL: z.string().default('info'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number; host: string;
  databaseUrl?: string; pgliteDir: string;
  jwtSecret: Uint8Array;
  secretsKey: Buffer;
  publicUrl: string;
  uploadDir: string;
  allowSandbox: boolean;
  cookieSecure: boolean;
  logLevel: string;
}

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof Env>, string>> = {}): Config {
  const e = Env.parse({ ...process.env, ...overrides });
  const prod = e.NODE_ENV === 'production';
  if (prod && (!e.JWT_SECRET || e.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET (>=32 chars) is required in production');
  if (prod && !e.SECRETS_KEY) throw new Error('SECRETS_KEY (base64, 32 bytes) is required in production');
  if (prod && !e.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  // Dev/test fallbacks are deterministic-but-obviously-insecure and never usable in production.
  const jwt = e.JWT_SECRET ?? 'dev-only-jwt-secret-do-not-use-in-production-0123456789';
  const key = e.SECRETS_KEY ? Buffer.from(e.SECRETS_KEY, 'base64') : createHash('sha256').update('dev-only-secrets-key').digest();
  if (key.length !== 32) throw new Error('SECRETS_KEY must decode to exactly 32 bytes');
  return {
    env: e.NODE_ENV, port: e.PORT, host: e.HOST,
    databaseUrl: e.DATABASE_URL, pgliteDir: e.PGLITE_DIR,
    jwtSecret: new TextEncoder().encode(jwt),
    secretsKey: key,
    publicUrl: e.PUBLIC_URL.replace(/\/$/, ''),
    uploadDir: e.UPLOAD_DIR,
    allowSandbox: e.ALLOW_SANDBOX ?? !prod,
    cookieSecure: e.COOKIE_SECURE ?? prod,
    logLevel: e.LOG_LEVEL,
  };
}
