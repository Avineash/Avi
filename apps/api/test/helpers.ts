import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { openDb, SYSTEM, tenant, type Db } from '../src/db.js';
import { buildApp, type AppCtx } from '../src/app.js';
import { seedDemo, DEMO_PASSWORD, DEMO_TOKEN } from '../src/seed.js';

export { DEMO_PASSWORD, DEMO_TOKEN, SYSTEM, tenant };
let n = 0;

/** Fresh isolated database per test file. Real PostgreSQL when TEST_DATABASE_URL is set, embedded PGlite otherwise. */
export async function makeApp(env: 'test' | 'development' = 'test'): Promise<AppCtx & { close: () => Promise<void>; login: (email: string) => Promise<Record<string, string>>; json: (res: any) => any }> {
  const base = process.env.TEST_DATABASE_URL;
  let url: string | undefined, drop: (() => Promise<void>) | undefined;
  if (base) {
    const name = `tf_test_${process.pid}_${Date.now()}_${n++}`;
    const admin = new pg.Client({ connectionString: base }); await admin.connect();
    await admin.query(`create database ${name}`);
    const u = new URL(base); u.pathname = '/' + name; url = u.toString();
    drop = async () => { await admin.query(`drop database ${name} with (force)`); await admin.end(); };
  }
  const cfg = loadConfig({ NODE_ENV: env, ...(url ? { DATABASE_URL: url } : {}), PGLITE_DIR: 'memory', LOG_LEVEL: 'silent', PUBLIC_URL: 'http://localhost:3000' } as any);
  const db: Db = await openDb(cfg);
  await seedDemo(db, { history: false });

  const ctx = await buildApp(cfg, db);
  return {
    ...ctx,
    close: async () => { await ctx.app.close(); await db.close(); await drop?.(); },
    login: async (email: string) => {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEMO_PASSWORD } });
      if (r.statusCode !== 200) throw new Error('login failed ' + r.body);
      const c = r.cookies.find((x) => x.name === 'tf_session')!;
      return { cookie: `tf_session=${c.value}`, 'x-tf-csrf': '1' };
    },
    json: (res: any) => JSON.parse(res.body),
  };
}

/** A customer places an order at demo table 1. */
let rot = 0; let tokens: string[] = [];
export async function placeOrder(t: Awaited<ReturnType<typeof makeApp>>, token?: string, key = 'k-' + Math.random().toString(36).slice(2, 12)) {
  if (!tokens.length) tokens = (await t.db.raw(`select token from dining_tables where label like 'T%' and token like 'demo-table-%' order by label`)).map((r: any) => r.token);
  token ??= tokens[rot++ % tokens.length];
  const ctxRes = await t.app.inject({ method: 'GET', url: `/api/public/t/${token}` });
  const menu = t.json(ctxRes).menu;
  const kottu = menu.flatMap((c: any) => c.items).find((i: any) => i.name.en === 'Chicken Kottu');
  const spice = kottu.optionGroups.find((g: any) => g.name.en === 'Spice level');
  const res = await t.app.inject({ method: 'POST', url: `/api/public/t/${token}/orders`, headers: { 'idempotency-key': key },
    payload: { items: [{ itemId: kottu.id, qty: 2, optionIds: [spice.options[1].id] }], lang: 'en' } });
  return { res, order: res.statusCode === 200 ? t.json(res) : null, kottu, key };
}
