import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_OVERRIDE_POLICY, diffConfigs, fingerprint, auditTheme, normalizePolicy, policyViolations,
  resolveTheme, summarizeChanges, validateThemeConfig, CONFIG_GROUPS,
  type AuditReport, type ConfigGroup, type OverridePolicy, type ThemeConfig,
} from '@staffhub/theme-core';
import type { Ctx } from '../auth.ts';
import { all, get, now, run, tx, type DB } from '../db.ts';
import { HttpError, forbidden, notFound } from '../http.ts';
import { inspectImage, type AssetKind } from './assets.ts';

export interface ScopeRow {
  id: string; scope_key: string; company_id: string; property_id: string | null;
  draft_config: string | null; draft_revision: number; draft_updated_at: string | null; draft_updated_by: string | null;
  active_version: number | null; override_policy: string | null;
}
interface VersionRow {
  id: string; scope_id: string; version: number; config: string; kind: 'publish' | 'rollback'; restored_from: number | null;
  note: string | null; a11y_acknowledged: number; created_by: string | null; created_at: string; author?: string | null;
}

const parse = (s: string | null | undefined): ThemeConfig => (s ? (JSON.parse(s) as ThemeConfig) : {});
const keyOf = (companyId: string, propertyId: string | null) => (propertyId ? `${companyId}:${propertyId}` : companyId);

// ─────────────────────────── scopes & permissions ───────────────────────────

export function ensureScope(db: DB, companyId: string, propertyId: string | null): ScopeRow {
  const key = keyOf(companyId, propertyId);
  const existing = get<ScopeRow>(db, 'SELECT * FROM theme_scopes WHERE scope_key = ?', key);
  if (existing) return existing;
  run(db, 'INSERT INTO theme_scopes (id, scope_key, company_id, property_id) VALUES (?,?,?,?)', randomUUID(), key, companyId, propertyId);
  return get<ScopeRow>(db, 'SELECT * FROM theme_scopes WHERE scope_key = ?', key)!;
}

/** Resolves the `:scope` URL parameter ("company" or a property id) inside the caller's own company only. */
export function resolveScope(db: DB, ctx: Ctx, param: string): ScopeRow {
  if (param === 'company') return ensureScope(db, ctx.companyId, null);
  const prop = get<{ id: string }>(db, 'SELECT id FROM properties WHERE id = ? AND company_id = ?', param, ctx.companyId);
  if (!prop) throw notFound('Scope not found.'); // identical response for "other tenant's property" and "no such property"
  return ensureScope(db, ctx.companyId, prop.id);
}

/** company_admin → every scope of their company. property_admin → their own property only. Everyone else → none. */
export function canManage(ctx: Ctx, scope: Pick<ScopeRow, 'company_id' | 'property_id'>): boolean {
  if (scope.company_id !== ctx.companyId) return false;
  if (ctx.role === 'company_admin') return true;
  return ctx.role === 'property_admin' && scope.property_id !== null && scope.property_id === ctx.propertyId;
}
export function assertCanManage(ctx: Ctx, scope: ScopeRow) {
  if (!canManage(ctx, scope)) throw forbidden('Only administrators of this company or property can manage its branding.');
}

export function getPolicy(db: DB, companyId: string): OverridePolicy {
  const row = ensureScope(db, companyId, null);
  return row.override_policy ? normalizePolicy(JSON.parse(row.override_policy)) : { ...DEFAULT_OVERRIDE_POLICY };
}

/** Which groups the caller may edit in this scope. */
export function editableGroups(db: DB, ctx: Ctx, scope: ScopeRow): Record<ConfigGroup, boolean> {
  const out = {} as Record<ConfigGroup, boolean>;
  const policy = getPolicy(db, ctx.companyId);
  for (const g of CONFIG_GROUPS) out[g] = ctx.role === 'company_admin' ? true : scope.property_id !== null && policy[g];
  return out;
}

export function setPolicy(db: DB, ctx: Ctx, input: unknown): OverridePolicy {
  if (ctx.role !== 'company_admin') throw forbidden('Only company administrators can change the override policy.');
  const policy = normalizePolicy(input);
  const row = ensureScope(db, ctx.companyId, null);
  run(db, 'UPDATE theme_scopes SET override_policy = ? WHERE id = ?', JSON.stringify(policy), row.id);
  log(db, ctx, 'brand.policy', JSON.stringify(policy));
  return policy;
}

// ─────────────────────────── layers & resolution ───────────────────────────

export function activeConfig(db: DB, scope: ScopeRow): ThemeConfig {
  if (scope.active_version === null) return {};
  const v = get<{ config: string }>(db, 'SELECT config FROM theme_versions WHERE scope_id = ? AND version = ?', scope.id, scope.active_version);
  return parse(v?.config);
}

/** A company's display name defaults to its record name, so "Your Company" never reaches a real tenant. */
function companyNameLayer(db: DB, companyId: string): ThemeConfig {
  const c = get<{ name: string }>(db, 'SELECT name FROM companies WHERE id = ?', companyId);
  return c ? { identity: { companyName: c.name } } : {};
}

/** The property's display name defaults to its record name, so a new property is branded correctly before anyone touches the editor. */
function propertyNameLayer(db: DB, companyId: string, propertyId: string): ThemeConfig {
  const p = get<{ name: string }>(db, 'SELECT name FROM properties WHERE id = ? AND company_id = ?', propertyId, companyId);
  return p ? { identity: { propertyName: p.name } } : {};
}

/** Layers a scope inherits from (published only; drafts of a parent never leak into a child). */
export function inheritedLayers(db: DB, scope: ScopeRow): ThemeConfig[] {
  const base = companyNameLayer(db, scope.company_id);
  if (!scope.property_id) return [base];
  const company = ensureScope(db, scope.company_id, null);
  return [base, activeConfig(db, company), propertyNameLayer(db, scope.company_id, scope.property_id)];
}

export interface PublishedTheme { config: ThemeConfig; fingerprint: string; companyVersion: number | null; propertyVersion: number | null }

/** The theme end users see: system default → company (published) → property (published). */
export function publishedTheme(db: DB, companyId: string, propertyId: string | null): PublishedTheme {
  const company = ensureScope(db, companyId, null);
  const layers: ThemeConfig[] = [companyNameLayer(db, companyId), activeConfig(db, company)];
  let propertyVersion: number | null = null;
  if (propertyId) {
    layers.push(propertyNameLayer(db, companyId, propertyId));
    const prop = ensureScope(db, companyId, propertyId);
    layers.push(activeConfig(db, prop));
    propertyVersion = prop.active_version;
  }
  const config = resolveTheme(...layers).config;
  return { config, fingerprint: fingerprint(config), companyVersion: company.active_version, propertyVersion };
}

// ─────────────────────────── validation ───────────────────────────

function validateLayer(db: DB, ctx: Ctx, scope: ScopeRow, input: unknown): ThemeConfig {
  const r = validateThemeConfig(input);
  if (!r.ok) throw new HttpError(400, 'invalid_theme', 'The theme contains invalid values.', { errors: r.errors });
  const config = r.config;

  if (!scope.property_id && config.identity && 'propertyName' in config.identity) {
    throw new HttpError(400, 'invalid_theme', 'A property name can only be set on a property, not on the company.', { errors: ['identity.propertyName is only valid on a property.'] });
  }
  // Delegation: property administrators may only touch the groups the company has opened up.
  if (ctx.role !== 'company_admin') {
    const blocked = policyViolations(config, getPolicy(db, ctx.companyId));
    if (blocked.length) {
      throw new HttpError(403, 'policy_violation', `Your company does not allow property-level changes to: ${blocked.join(', ')}.`, { groups: blocked });
    }
  }
  // Tenant isolation for assets: a layer may only reference images uploaded by the same company.
  const id = config.identity;
  const refs: Array<[string | null | undefined, AssetKind[]]> = [
    [id?.logoAssetId, ['logo', 'logoDark']], [id?.logoDarkAssetId, ['logo', 'logoDark']], [id?.faviconAssetId, ['favicon', 'logo']],
  ];
  for (const [ref, kinds] of refs) {
    if (!ref) continue;
    const a = get<{ kind: AssetKind }>(db, 'SELECT kind FROM brand_assets WHERE id = ? AND company_id = ?', ref, ctx.companyId);
    if (!a || !kinds.includes(a.kind)) throw new HttpError(400, 'invalid_theme', 'A referenced image does not exist.', { errors: ['Unknown image.'] });
  }
  return config;
}

export function auditLayer(db: DB, scope: ScopeRow, layer: ThemeConfig): AuditReport {
  return auditTheme(resolveTheme(...inheritedLayers(db, scope), layer));
}

// ─────────────────────────── editor state ───────────────────────────

export function editorState(db: DB, ctx: Ctx, scope: ScopeRow) {
  const active = activeConfig(db, scope);
  const hasDraft = scope.draft_config !== null;
  const meta = scope.active_version === null ? null
    : get<{ version: number; created_at: string; author: string | null; note: string | null; kind: string }>(db,
        `SELECT v.version, v.created_at, v.note, v.kind, u.name AS author FROM theme_versions v LEFT JOIN users u ON u.id = v.created_by
          WHERE v.scope_id = ? AND v.version = ?`, scope.id, scope.active_version) ?? null;
  const target = scope.property_id
    ? get<{ name: string }>(db, 'SELECT name FROM properties WHERE id = ?', scope.property_id)?.name
    : get<{ name: string }>(db, 'SELECT name FROM companies WHERE id = ?', scope.company_id)?.name;
  return {
    scope: { key: scope.property_id ?? 'company', type: scope.property_id ? 'property' : 'company', propertyId: scope.property_id, name: target ?? '' },
    draft: {
      config: hasDraft ? parse(scope.draft_config) : active,
      revision: scope.draft_revision,
      hasUnpublishedChanges: hasDraft,
      updatedAt: scope.draft_updated_at,
    },
    active: meta ? { version: meta.version, config: active, publishedAt: meta.created_at, publishedBy: meta.author, note: meta.note, kind: meta.kind } : null,
    inheritedLayers: inheritedLayers(db, scope),
    policy: getPolicy(db, ctx.companyId),
    editable: editableGroups(db, ctx, scope),
    canEditPolicy: ctx.role === 'company_admin' && !scope.property_id,
  };
}

export function listScopes(db: DB, ctx: Ctx) {
  const rows = ctx.role === 'company_admin'
    ? [{ id: null as string | null, name: get<{ name: string }>(db, 'SELECT name FROM companies WHERE id = ?', ctx.companyId)!.name }, ...all<{ id: string; name: string }>(db, 'SELECT id, name FROM properties WHERE company_id = ? ORDER BY name', ctx.companyId)]
    : ctx.role === 'property_admin' && ctx.propertyId
      ? [{ id: ctx.propertyId, name: get<{ name: string }>(db, 'SELECT name FROM properties WHERE id = ? AND company_id = ?', ctx.propertyId, ctx.companyId)?.name ?? '' }]
      : [];
  return rows.map((r) => {
    const scope = ensureScope(db, ctx.companyId, r.id);
    return {
      key: r.id ?? 'company', type: r.id ? 'property' : 'company', name: r.name,
      activeVersion: scope.active_version, hasUnpublishedChanges: scope.draft_config !== null,
      overrides: r.id ? Object.keys(activeConfig(db, scope)).length > 0 : null,
    };
  });
}

// ─────────────────────────── draft / publish / rollback ───────────────────────────

function conflict(current: number): never {
  throw new HttpError(409, 'revision_conflict', 'Someone else changed this draft. Reload to see their changes.', { currentRevision: current });
}

export function saveDraft(db: DB, ctx: Ctx, scope: ScopeRow, input: unknown, baseRevision: unknown) {
  assertCanManage(ctx, scope);
  return tx(db, () => {
    const row = get<ScopeRow>(db, 'SELECT * FROM theme_scopes WHERE id = ?', scope.id)!;
    if (typeof baseRevision !== 'number' || baseRevision !== row.draft_revision) conflict(row.draft_revision);
    const config = validateLayer(db, ctx, row, input);
    const same = diffConfigs(activeConfig(db, row), config).length === 0;
    const revision = row.draft_revision + 1;
    run(db, 'UPDATE theme_scopes SET draft_config = ?, draft_revision = ?, draft_updated_at = ?, draft_updated_by = ? WHERE id = ?',
      same ? null : JSON.stringify(config), revision, now(), ctx.userId, row.id);
    return { revision, hasUnpublishedChanges: !same };
  });
}

export function discardDraft(db: DB, ctx: Ctx, scope: ScopeRow) {
  assertCanManage(ctx, scope);
  return tx(db, () => {
    const row = get<ScopeRow>(db, 'SELECT * FROM theme_scopes WHERE id = ?', scope.id)!;
    run(db, 'UPDATE theme_scopes SET draft_config = NULL, draft_revision = ?, draft_updated_at = ?, draft_updated_by = ? WHERE id = ?',
      row.draft_revision + 1, now(), ctx.userId, row.id);
    log(db, ctx, 'brand.draft.discard', scope.scope_key);
    return { revision: row.draft_revision + 1 };
  });
}

function nextVersion(db: DB, scopeId: string): number {
  return (get<{ m: number | null }>(db, 'SELECT MAX(version) AS m FROM theme_versions WHERE scope_id = ?', scopeId)?.m ?? 0) + 1;
}

export function publish(db: DB, ctx: Ctx, scope: ScopeRow, opts: { baseRevision: unknown; note?: unknown; acknowledgeAccessibility?: unknown }) {
  assertCanManage(ctx, scope);
  return tx(db, () => {
    const row = get<ScopeRow>(db, 'SELECT * FROM theme_scopes WHERE id = ?', scope.id)!;
    // Publish exactly what the administrator previewed: if the draft moved on since, refuse.
    if (typeof opts.baseRevision !== 'number' || opts.baseRevision !== row.draft_revision) conflict(row.draft_revision);
    if (row.draft_config === null) throw new HttpError(400, 'nothing_to_publish', 'There are no unpublished changes.');
    const config = validateLayer(db, ctx, row, parse(row.draft_config)); // re-validate: policy or assets may have changed since save

    const report = auditLayer(db, row, config);
    if (report.blocking.length) {
      throw new HttpError(422, 'accessibility_blocking', 'Leave status colours must meet WCAG 2.2 AA contrast before publishing.', { report });
    }
    const acknowledged = opts.acknowledgeAccessibility === true;
    if (report.acknowledgeable.length && !acknowledged) {
      throw new HttpError(422, 'accessibility_ack_required', 'This theme has accessibility failures. Review them, or acknowledge to publish anyway.', { report });
    }

    const note = typeof opts.note === 'string' ? opts.note.trim().slice(0, 300) || null : null;
    const version = nextVersion(db, row.id);
    run(db, `INSERT INTO theme_versions (id, scope_id, company_id, property_id, version, config, kind, note, a11y_acknowledged, created_by, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      randomUUID(), row.id, row.company_id, row.property_id, version, JSON.stringify(config), 'publish', note,
      report.acknowledgeable.length ? 1 : 0, ctx.userId, now());
    run(db, 'UPDATE theme_scopes SET active_version = ?, draft_config = NULL, draft_revision = ?, draft_updated_at = ?, draft_updated_by = ? WHERE id = ?',
      version, row.draft_revision + 1, now(), ctx.userId, row.id);
    log(db, ctx, 'brand.publish', JSON.stringify({ scope: row.property_id ?? 'company', version }));
    return { version, revision: row.draft_revision + 1, acknowledgedIssues: report.acknowledgeable.length };
  });
}

export function rollback(db: DB, ctx: Ctx, scope: ScopeRow, version: unknown, note: unknown) {
  assertCanManage(ctx, scope);
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new HttpError(400, 'bad_request', 'version must be a number.');
  return tx(db, () => {
    const row = get<ScopeRow>(db, 'SELECT * FROM theme_scopes WHERE id = ?', scope.id)!;
    const target = get<VersionRow>(db, 'SELECT * FROM theme_versions WHERE scope_id = ? AND version = ?', row.id, version);
    if (!target) throw notFound('That version does not exist.');
    if (row.active_version === version) throw new HttpError(400, 'already_active', 'That version is already the active theme.');
    const config = validateLayer(db, ctx, row, parse(target.config));
    const next = nextVersion(db, row.id);
    const n = typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : `Restored version ${version}`;
    run(db, `INSERT INTO theme_versions (id, scope_id, company_id, property_id, version, config, kind, restored_from, note, created_by, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      randomUUID(), row.id, row.company_id, row.property_id, next, JSON.stringify(config), 'rollback', version, n, ctx.userId, now());
    run(db, 'UPDATE theme_scopes SET active_version = ?, draft_config = NULL, draft_revision = ?, draft_updated_at = ?, draft_updated_by = ? WHERE id = ?',
      next, row.draft_revision + 1, now(), ctx.userId, row.id);
    log(db, ctx, 'brand.rollback', JSON.stringify({ scope: row.property_id ?? 'company', restored: version, version: next }));
    return { version: next, restoredFrom: version, revision: row.draft_revision + 1 };
  });
}

export function listVersions(db: DB, ctx: Ctx, scope: ScopeRow) {
  assertCanManage(ctx, scope);
  const rows = all<VersionRow>(db,
    `SELECT v.*, u.name AS author FROM theme_versions v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.scope_id = ? ORDER BY v.version ASC`, scope.id);
  let prev: ThemeConfig = {};
  const out = rows.map((r) => {
    const cfg = parse(r.config);
    const summary = summarizeChanges(diffConfigs(prev, cfg));
    prev = cfg;
    return {
      version: r.version, kind: r.kind, restoredFrom: r.restored_from, note: r.note, author: r.author ?? null,
      createdAt: r.created_at, accessibilityAcknowledged: !!r.a11y_acknowledged, active: r.version === scope.active_version, summary,
    };
  });
  return out.reverse();
}

export function getVersion(db: DB, ctx: Ctx, scope: ScopeRow, version: number) {
  assertCanManage(ctx, scope);
  const v = get<VersionRow>(db, 'SELECT * FROM theme_versions WHERE scope_id = ? AND version = ?', scope.id, version);
  if (!v) throw notFound('That version does not exist.');
  return { version: v.version, config: parse(v.config), kind: v.kind, createdAt: v.created_at, note: v.note };
}

// ─────────────────────────── assets ───────────────────────────

const MAX_ASSETS_PER_COMPANY = 200;

export function saveAsset(db: DB, ctx: Ctx, kind: AssetKind, bytes: Uint8Array) {
  if (ctx.role !== 'company_admin') {
    if (ctx.role !== 'property_admin' || !getPolicy(db, ctx.companyId).identity) throw forbidden('You are not allowed to upload brand images.');
  }
  const { mime } = inspectImage(bytes, kind);
  const count = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM brand_assets WHERE company_id = ?', ctx.companyId)!.n;
  if (count >= MAX_ASSETS_PER_COMPANY) throw new HttpError(413, 'too_many_assets', 'Image library is full.');
  const id = randomUUID();
  run(db, 'INSERT INTO brand_assets (id, company_id, kind, mime, bytes, size, sha256, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, ctx.companyId, kind, mime, bytes, bytes.length, createHash('sha256').update(bytes).digest('hex'), ctx.userId, now());
  log(db, ctx, 'brand.asset.upload', JSON.stringify({ id, kind, mime, size: bytes.length }));
  return { id, url: `/api/assets/${id}`, mime, size: bytes.length };
}

/** Public by design: the id is a random 122-bit UUID and the content is brand imagery shown on the sign-in page. */
export function getAsset(db: DB, id: string) {
  return get<{ mime: string; bytes: Uint8Array; sha256: string }>(db, 'SELECT mime, bytes, sha256 FROM brand_assets WHERE id = ?', id);
}

// ─────────────────────────── audit log ───────────────────────────

export function log(db: DB, ctx: Pick<Ctx, 'companyId' | 'userId'>, action: string, detail: string) {
  run(db, 'INSERT INTO audit_log (company_id, actor_id, action, detail, created_at) VALUES (?,?,?,?,?)', ctx.companyId, ctx.userId, action, detail, now());
}

export function listAudit(db: DB, ctx: Ctx, limit = 50) {
  if (ctx.role !== 'company_admin') throw forbidden('Only company administrators can read the audit log.');
  return all(db,
    `SELECT a.id, a.action, a.detail, a.created_at AS createdAt, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.company_id = ? AND a.action LIKE 'brand.%' ORDER BY a.id DESC LIMIT ?`, ctx.companyId, Math.min(limit, 200));
}

