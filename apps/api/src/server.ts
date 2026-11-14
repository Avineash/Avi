import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { ensureBasePlans } from './seed.js';

const cfg = loadConfig();
const db = await openDb(cfg);
await ensureBasePlans(db);
const { app, svc } = await buildApp(cfg, db);

// Safety net for lost webhooks: status-enquire open payments, expire stale ones.
const sweeper = setInterval(() => { svc.sweep().catch((e) => app.log.error({ err: e }, 'sweep failed')); }, 15_000);

await app.listen({ port: cfg.port, host: cfg.host });
if (cfg.allowSandbox) app.log.warn('SANDBOX payment providers are enabled — payments are simulated, no real money moves');

const stop = async () => { clearInterval(sweeper); await app.close(); await db.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
