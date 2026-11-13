import { existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { seedDemo } from './seed.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? resolve(here, '../../../data/staffhub.db');
const port = Number(process.env.PORT ?? 8787);
const demo = process.env.SEED_DEMO !== '0';

const db = openDb(dbPath);
if (demo) seedDemo(db);
const app = createApp({ db, demo });

// In production the built web app is served by the same origin, so cookies and CSRF protections stay simple.
const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  const root = relative(process.cwd(), webDist) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' })); // SPA fallback
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`StaffHub API listening on http://localhost:${info.port}  (db: ${dbPath}${demo ? ', demo data on' : ''})`);
});
