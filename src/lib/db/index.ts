import fs from "node:fs";
import path from "node:path";

export type Row = Record<string, any>;
export interface QueryResult<T = Row> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Db extends Queryable {
  kind: "pglite" | "pg";
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** A transaction handle with post-commit hooks (realtime fan-out, notification flush…). */
export interface Tx extends Queryable {
  after(fn: () => void | Promise<void>): void;
}

type G = typeof globalThis & { __eh_db?: Promise<Db>; __eh_maint?: NodeJS.Timeout };
const g = globalThis as G;

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR || undefined);
  await pg.waitReady;
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    kind: "pglite",
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    exec: async (sql) => { await pg.exec(sql); },
    close: () => pg.close(),
  };
}

export async function createPg(url: string): Promise<Db> {
  const pgmod = await import("pg");
  const { Pool, types } = pgmod.default ?? pgmod;
  types.setTypeParser(20, (v: string) => Number(v)); // int8 -> number (cents totals fit comfortably)
  const pool = new Pool({ connectionString: url, max: 10 });
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
  });
  return {
    kind: "pg",
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(wrap(client));
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => { await pool.query(sql); },
    close: () => pool.end(),
  };
}

export async function migrate(db: Db, dir = path.join(process.cwd(), "db", "migrations")): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.exec(sql); // a multi-statement simple query runs as one implicit transaction in Postgres
    await db.query("insert into schema_migrations(name) values ($1)", [f]);
    applied.push(f);
  }
  return applied;
}

async function boot(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  const db = url ? await createPg(url) : await createPglite();
  const isEmbedded = db.kind === "pglite";
  if (isEmbedded || process.env.AUTO_MIGRATE === "true") await migrate(db);
  const wantSeed = isEmbedded ? process.env.SEED_DEMO !== "false" : process.env.SEED_DEMO === "true";
  if (wantSeed && process.env.NODE_ENV !== "test") {
    const { rows } = await db.query("select to_regclass('public.users') as t");
    if (rows[0]?.t) {
      const { rows: c } = await db.query<{ n: number }>("select count(*)::int as n from users");
      if (c[0].n === 0) {
        const { seedDemo } = await import("./seed");
        __setDb(Promise.resolve(db)); // seed uses domain services which call getDb()
        await seedDemo();
      }
    }
  }
  startBackgroundJobs();
  return db;
}

function startBackgroundJobs() {
  if (g.__eh_maint || process.env.NODE_ENV === "test" || process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  // Single-process scheduler for dev / self-hosted. In serverless, call /api/cron/maintenance from a scheduler.
  g.__eh_maint = setInterval(async () => {
    try {
      const { runMaintenance } = await import("@/lib/domain/maintenance");
      await runMaintenance();
    } catch (e) {
      console.error("[maintenance] failed", e);
    }
  }, 20_000);
  g.__eh_maint.unref?.();
}

export function getDb(): Promise<Db> {
  return (g.__eh_db ??= boot());
}
/** Test hook / seeding hook. */
export function __setDb(p: Promise<Db>) {
  g.__eh_db = p;
}
/**
 * Test database. By default an in-process PGlite instance. If TEST_DATABASE_URL points at a real Postgres server,
 * each test file gets its own freshly-created database there, so the suite exercises genuine multi-connection concurrency.
 */
export async function createTestDb(): Promise<Db> {
  const admin = process.env.TEST_DATABASE_URL;
  if (admin) {
    const name = `eh_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const a = await createPg(admin);
    await a.exec(`create database ${name}`);
    await a.close();
    const u = new URL(admin); u.pathname = `/${name}`;
    const db = await createPg(u.toString());
    await migrate(db);
    return db;
  }
  const db = await createPglite();
  await migrate(db);
  return db;
}

/** Run `fn` in a transaction; post-commit hooks run only if the transaction committed. */
export async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  const hooks: Array<() => void | Promise<void>> = [];
  const out = await db.tx((q) => fn({ query: q.query.bind(q), after: (h) => { hooks.push(h); } }));
  for (const h of hooks) {
    try { await h(); } catch (e) { console.error("[after-commit hook]", e); }
  }
  return out;
}

export async function q(): Promise<Queryable> {
  return getDb();
}
export async function one<T = Row>(c: Queryable, sql: string, params?: unknown[]): Promise<T | null> {
  const r = await c.query<T>(sql, params);
  return r.rows[0] ?? null;
}
