import { loadConfig } from './config.js';
import { openDb } from './db.js';
const db = await openDb(loadConfig());   // openDb runs pending migrations
console.log('migrations applied'); await db.close();
