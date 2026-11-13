import { Hono } from 'hono';
import type { Env } from '../auth.ts';
import { HttpError, badRequest, forbidden } from '../http.ts';
import { ASSET_KINDS, MAX_BYTES, type AssetKind } from './assets.ts';
import {
  assertCanManage, discardDraft, editorState, getVersion, listAudit, listScopes, listVersions, publish, resolveScope,
  rollback, saveAsset, saveDraft, setPolicy,
} from './store.ts';

/** /api/brand — administrator endpoints. Authentication is applied by the parent app. */
export const brandRoutes = new Hono<Env>();

const jsonBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
  try {
    const b = await c.req.json();
    if (typeof b !== 'object' || b === null || Array.isArray(b)) throw new Error();
    return b as Record<string, unknown>;
  } catch { throw badRequest('Request body must be a JSON object.'); }
};

// Anyone who cannot manage *any* scope gets a clear 403 rather than an empty page.
brandRoutes.use('*', async (c, next) => {
  const { role } = c.get('ctx');
  if (role !== 'company_admin' && role !== 'property_admin') throw forbidden('Brand & Appearance is available to administrators only.');
  await next();
});

brandRoutes.get('/scopes', (c) => c.json({ scopes: listScopes(c.get('db'), c.get('ctx')) }));

brandRoutes.get('/scope/:scope', (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  const scope = resolveScope(db, ctx, c.req.param('scope'));
  assertCanManage(ctx, scope);
  return c.json(editorState(db, ctx, scope));
});

brandRoutes.put('/scope/:scope/draft', async (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  const scope = resolveScope(db, ctx, c.req.param('scope'));
  const body = await jsonBody(c);
  return c.json(saveDraft(db, ctx, scope, body.config, body.baseRevision));
});

brandRoutes.delete('/scope/:scope/draft', (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  return c.json(discardDraft(db, ctx, resolveScope(db, ctx, c.req.param('scope'))));
});

brandRoutes.post('/scope/:scope/publish', async (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  const scope = resolveScope(db, ctx, c.req.param('scope'));
  const body = await jsonBody(c);
  return c.json(publish(db, ctx, scope, { baseRevision: body.baseRevision, note: body.note, acknowledgeAccessibility: body.acknowledgeAccessibility }), 201);
});

brandRoutes.get('/scope/:scope/versions', (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  return c.json({ versions: listVersions(db, ctx, resolveScope(db, ctx, c.req.param('scope'))) });
});

brandRoutes.get('/scope/:scope/versions/:version', (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  const n = Number(c.req.param('version'));
  if (!Number.isInteger(n)) throw badRequest('Invalid version.');
  return c.json(getVersion(db, ctx, resolveScope(db, ctx, c.req.param('scope')), n));
});

brandRoutes.post('/scope/:scope/rollback', async (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  const scope = resolveScope(db, ctx, c.req.param('scope'));
  const body = await jsonBody(c);
  return c.json(rollback(db, ctx, scope, body.version, body.note), 201);
});

brandRoutes.put('/policy', async (c) => {
  const body = await jsonBody(c);
  return c.json({ policy: setPolicy(c.get('db'), c.get('ctx'), body.policy) });
});

brandRoutes.get('/audit', (c) => c.json({ entries: listAudit(c.get('db'), c.get('ctx')) }));

brandRoutes.post('/assets', async (c) => {
  const kind = c.req.query('kind') as AssetKind;
  if (!ASSET_KINDS.includes(kind)) throw badRequest(`kind must be one of: ${ASSET_KINDS.join(', ')}.`);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_BYTES[kind]) throw new HttpError(413, 'file_too_large', `Maximum size for this image is ${Math.round(MAX_BYTES[kind] / 1024)} KB.`);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  return c.json(saveAsset(c.get('db'), c.get('ctx'), kind, bytes), 201);
});
