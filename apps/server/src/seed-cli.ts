import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { seedDemo, DEMO_PASSWORD } from './seed.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? resolve(here, '../../../data/staffhub.db');
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
const db = openDb(dbPath);
seedDemo(db);
console.log(`Seeded ${dbPath}. Every demo user's password is "${DEMO_PASSWORD}".`);
