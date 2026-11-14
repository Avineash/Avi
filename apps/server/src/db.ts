import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

/**
 * Schema notes
 *  - Every business and brand table carries `company_id`. Repositories always filter by the company of the
 *    authenticated session, never by a client-supplied value. On PostgreSQL the same column is what you would
 *    attach row-level-security policies to (see docs/ARCHITECTURE.md).
 *  - Theme tables hold *no* foreign keys into business tables and vice versa, so a theme change cannot touch
 *    employee, leave or roster data.
 *  - Published theme versions are immutable. "Rollback" publishes a new version that copies an old one.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL, slug TEXT NOT NULL, UNIQUE (company_id, slug)
);
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT REFERENCES properties(id), department_id TEXT REFERENCES departments(id),
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee','manager','property_admin','company_admin')),
  appearance_pref TEXT CHECK (appearance_pref IN ('light','dark','system')),
  -- Night-audit module access, independent of the workforce role: who may run or only view the nightly audit.
  audit_access TEXT CHECK (audit_access IN ('auditor','manager','both')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_company ON users(company_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id), department_id TEXT NOT NULL REFERENCES departments(id),
  employee_id TEXT NOT NULL REFERENCES users(id),
  leave_type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT, decided_by TEXT REFERENCES users(id), decided_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leave_company ON leave_requests(company_id, start_date);
CREATE TABLE IF NOT EXISTS roster_shifts (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id), department_id TEXT NOT NULL REFERENCES departments(id),
  employee_id TEXT NOT NULL REFERENCES users(id),
  shift_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS roster_company ON roster_shifts(company_id, shift_date);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending','approved','rejected','cancelled')),
  title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(company_id, user_id, created_at);

-- Branding ---------------------------------------------------------------
-- One row per (company) or (company, property). 'scope_key' is "<companyId>" or "<companyId>:<propertyId>".
CREATE TABLE IF NOT EXISTS theme_scopes (
  id TEXT PRIMARY KEY, scope_key TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id), property_id TEXT REFERENCES properties(id),
  draft_config TEXT,                       -- NULL = no unpublished changes
  draft_revision INTEGER NOT NULL DEFAULT 0,
  draft_updated_at TEXT, draft_updated_by TEXT REFERENCES users(id),
  active_version INTEGER,                  -- NULL = inherits everything from the parent
  override_policy TEXT                     -- company scope only: JSON of groups property admins may override
);
CREATE TABLE IF NOT EXISTS theme_versions (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES theme_scopes(id),
  company_id TEXT NOT NULL REFERENCES companies(id), property_id TEXT REFERENCES properties(id),
  version INTEGER NOT NULL, config TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('publish','rollback')), restored_from INTEGER,
  note TEXT, a11y_acknowledged INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE (scope_id, version)
);
CREATE TABLE IF NOT EXISTS brand_assets (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('logo','logoDark','favicon')), mime TEXT NOT NULL,
  bytes BLOB NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
-- Night audit ---------------------------------------------------------------
-- Checklist templates are versioned per property. A run snapshots the template it started with, so editing the
-- checklist never rewrites an audit that is in progress or closed.
CREATE TABLE IF NOT EXISTS audit_templates (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), property_id TEXT NOT NULL REFERENCES properties(id),
  version INTEGER NOT NULL, config TEXT NOT NULL, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE (property_id, version)
);
CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), property_id TEXT NOT NULL REFERENCES properties(id),
  audit_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  template_version INTEGER NOT NULL, template TEXT NOT NULL,
  night_auditor TEXT NOT NULL DEFAULT '', night_manager TEXT NOT NULL DEFAULT '',
  -- one editor at a time: the holder's token must accompany every write; everyone else sees a read-only view
  lock_user_id TEXT, lock_name TEXT, lock_token TEXT, lock_heartbeat TEXT,
  created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL,
  closed_by TEXT, closed_at TEXT, close_note TEXT,
  UNIQUE (property_id, audit_date)
);
CREATE INDEX IF NOT EXISTS audit_runs_company ON audit_runs(company_id, audit_date);
CREATE TABLE IF NOT EXISTS audit_steps (
  run_id TEXT NOT NULL REFERENCES audit_runs(id), step_id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, initials TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', subs TEXT NOT NULL DEFAULT '[]',
  done_by TEXT, done_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, step_id)
);
CREATE TABLE IF NOT EXISTS audit_files (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), run_id TEXT NOT NULL REFERENCES audit_runs(id),
  step_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL,
  uploaded_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_files_run ON audit_files(run_id);
CREATE TABLE IF NOT EXISTS audit_ccrec (
  run_id TEXT PRIMARY KEY REFERENCES audit_runs(id), data TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL REFERENCES companies(id),
  actor_id TEXT, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_company ON audit_log(company_id, id);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Adds columns introduced after a database was first created (CREATE TABLE IF NOT EXISTS cannot). */
function migrate(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes('audit_access')) {
    db.exec("ALTER TABLE users ADD COLUMN audit_access TEXT CHECK (audit_access IN ('auditor','manager','both'))");
  }
}

type Row = Record<string, unknown>;
/** Typed helpers over node:sqlite so repositories stay readable. */
export const all = <T = Row>(db: DB, sql: string, ...params: unknown[]): T[] =>
  db.prepare(sql).all(...(params as never[])) as T[];
export const get = <T = Row>(db: DB, sql: string, ...params: unknown[]): T | undefined =>
  db.prepare(sql).get(...(params as never[])) as T | undefined;
export const run = (db: DB, sql: string, ...params: unknown[]) =>
  db.prepare(sql).run(...(params as never[]));

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const now = () => new Date().toISOString();
