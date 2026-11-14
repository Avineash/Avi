import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { migrations } from './migrations.js';
import type { Config } from './config.js';

/** bigint (counts, sums) → number. All money is integer cents well inside 2^53. */
pg.types.setTypeParser(20, (v) => Number(v));

export type Scope = { kind: 'system' } | { kind: 'tenant'; restaurantId: string };
export const SYSTEM: Scope = { kind: 'system' };
export const tenant = (restaurantId: string): Scope => ({ kind: 'tenant', restaurantId });

export interface Q {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  one<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
}
export interface Db {
  readonly kind: 'pg' | 'pglite';
  /**
   * Run `fn` in ONE database transaction under `scope`.
   * Inside, the session runs as the unprivileged `tf_app` role with row-level security
   * bound to the scope, so a bug in a query cannot read another restaurant's rows.
   */
  tx<T>(scope: Scope, fn: (q: Q) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  /** Unscoped query as the connecting (owner) role. Migrations and tests only. */
  raw<T = any>(sql: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
}

const mkQ = (run: (sql: string, params?: any[]) => Promise<any[]>): Q => ({
  query: run,
  one: async (sql, params) => (await run(sql, params))[0],
});
const scopeSql = (s: Scope) => ({
  sql: `select set_config('app.scope', $1, true), set_config('app.tenant_id', $2, true)`,
  params: [s.kind, s.kind === 'tenant' ? s.restaurantId : ''],
});

class PgDb implements Db {
  readonly kind = 'pg' as const;
  constructor(private pool: pg.Pool) {}
  async tx<T>(scope: Scope, fn: (q: Q) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE tf_app');
      const s = scopeSql(scope);
      await c.query(s.sql, s.params);
      const out = await fn(mkQ(async (sql, params) => (await c.query(sql, params)).rows));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* connection already dead */ }
      throw e;
    } finally { c.release(); }
  }
  async exec(sql: string) { await this.pool.query(sql); }
  async raw<T>(sql: string, params?: any[]) { return (await this.pool.query(sql, params)).rows as T[]; }
  async close() { await this.pool.end(); }
}

class LiteDb implements Db {
  readonly kind = 'pglite' as const;
  constructor(private db: PGlite) {}
  async tx<T>(scope: Scope, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.db.transaction(async (t) => {
      await t.query('SET LOCAL ROLE tf_app');
      const s = scopeSql(scope);
      await t.query(s.sql, s.params);
      return fn(mkQ(async (sql, params) => (await t.query(sql, params)).rows as any[]));
    });
  }
  async exec(sql: string) { await this.db.exec(sql); }
  async raw<T>(sql: string, params?: any[]) { return (await this.db.query(sql, params)).rows as T[]; }
  async close() { await this.db.close(); }
}

export async function openDb(cfg: Config): Promise<Db> {
  let db: Db;
  if (cfg.databaseUrl) {
    db = new PgDb(new pg.Pool({ connectionString: cfg.databaseUrl, max: 10, idleTimeoutMillis: 30_000 }));
  } else {
    if (cfg.env === 'production') throw new Error('Embedded PGlite is for development only');
    const dir = cfg.pgliteDir === 'memory' ? undefined : cfg.pgliteDir;
    db = new LiteDb(new PGlite(dir));
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db) {
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = (await db.raw<{ name: string }>('select name from schema_migrations')).map((r) => r.name);
  for (const m of migrations) {
    if (done.includes(m.name)) continue;
    await db.exec('begin;\n' + m.sql + `\ninsert into schema_migrations(name) values ('${m.name}');\ncommit;`);
  }
  await db.exec('grant select, insert on schema_migrations to tf_app');
}
