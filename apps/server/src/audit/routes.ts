import { Hono } from 'hono';
import type { Env } from '../auth.ts';
import { HttpError, badRequest, notFound } from '../http.ts';
import {
  accessibleProperties, addFile, assertView, closeRun, deleteFile, getCcRec, getFile, getRun, getTemplate, heartbeat, listAccess, listFiles,
  listRuns, openRun, overview, putCcRec, release, reopenRun, resolveProperty, saveTemplate, setAccess, summaryText, takeOver, updateMeta, updateStep,
} from './store.ts';
import { MAX_FILE_BYTES } from './files.ts';

/** /api/audit — night audit module. Authentication and the tenant context come from the parent app. */
export const auditRoutes = new Hono<Env>();

const json = async (c: { req: { json: () => Promise<unknown> } }) => { try { return await c.req.json(); } catch { throw badRequest('Request body must be JSON.'); } };
/** The edit-lock token travels in a header so it never appears in URLs or logs. */
const tok = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('x-audit-lock') ?? null;

auditRoutes.use('*', async (c, next) => { assertView(c.get('ctx')); await next(); });

auditRoutes.get('/properties', (c) => c.json({ properties: accessibleProperties(c.get('db'), c.get('ctx')) }));

auditRoutes.get('/template', (c) => {
  const db = c.get('db'), ctx = c.get('ctx');
  const p = resolveProperty(db, ctx, c.req.query('propertyId'));
  return c.json({ propertyId: p.id, ...getTemplate(db, ctx.companyId, p.id) });
});
auditRoutes.put('/template', async (c) => {
  const body = (await json(c)) as Record<string, unknown>;
  return c.json(saveTemplate(c.get('db'), c.get('ctx'), c.req.query('propertyId'), body.template), 201);
});

auditRoutes.get('/runs', (c) => c.json({ runs: listRuns(c.get('db'), c.get('ctx'), c.req.query('propertyId'), Number(c.req.query('limit') ?? 30) || 30) }));
auditRoutes.get('/overview', (c) => c.json({ date: c.req.query('date'), properties: overview(c.get('db'), c.get('ctx'), c.req.query('date')) }));

auditRoutes.get('/run', (c) => c.json(getRun(c.get('db'), c.get('ctx'), c.req.query('propertyId'), c.req.query('date'), tok(c))));
auditRoutes.post('/run/open', async (c) => {
  const b = (await json(c)) as Record<string, unknown>;
  return c.json(openRun(c.get('db'), c.get('ctx'), b.propertyId, b.date));
});

auditRoutes.post('/run/:id/takeover', (c) => c.json(takeOver(c.get('db'), c.get('ctx'), c.req.param('id'))));
auditRoutes.post('/run/:id/heartbeat', (c) => c.json(heartbeat(c.get('db'), c.get('ctx'), c.req.param('id'), tok(c))));
auditRoutes.post('/run/:id/release', (c) => c.json(release(c.get('db'), c.get('ctx'), c.req.param('id'), tok(c))));
auditRoutes.put('/run/:id/step/:stepId', async (c) => c.json(updateStep(c.get('db'), c.get('ctx'), c.req.param('id'), c.req.param('stepId'), await json(c), tok(c))));
auditRoutes.put('/run/:id/meta', async (c) => c.json(updateMeta(c.get('db'), c.get('ctx'), c.req.param('id'), await json(c), tok(c))));
auditRoutes.post('/run/:id/close', async (c) => c.json(closeRun(c.get('db'), c.get('ctx'), c.req.param('id'), await c.req.json().catch(() => ({})), tok(c))));
auditRoutes.post('/run/:id/reopen', (c) => c.json(reopenRun(c.get('db'), c.get('ctx'), c.req.param('id'))));
auditRoutes.get('/run/:id/summary', (c) => c.json({ text: summaryText(c.get('db'), c.get('ctx'), c.req.param('id')) }));

auditRoutes.get('/run/:id/ccrec', (c) => c.json({ data: getCcRec(c.get('db'), c.get('ctx'), c.req.param('id')) }));
auditRoutes.put('/run/:id/ccrec', async (c) => c.json(putCcRec(c.get('db'), c.get('ctx'), c.req.param('id'), await json(c), tok(c))));

auditRoutes.get('/run/:id/files', (c) => c.json({ files: listFiles(c.get('db'), c.get('ctx'), c.req.param('id')) }));
auditRoutes.post('/run/:id/files', async (c) => {
  const step = c.req.query('step');
  if (!step) throw badRequest('step is required.');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_FILE_BYTES + 1024) throw new HttpError(413, 'file_too_large', `Files are limited to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  let name = 'report';
  try { name = decodeURIComponent(c.req.header('x-file-name') ?? 'report'); } catch { /* keep default */ }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  return c.json(addFile(c.get('db'), c.get('ctx'), c.req.param('id'), step, name, bytes, tok(c)), 201);
});
auditRoutes.get('/files/:fileId', (c) => {
  const f = getFile(c.get('db'), c.get('ctx'), c.req.param('fileId'));
  c.header('Content-Type', f.mime);
  // Always a download, never rendered inside the app's origin; the sniffed type is authoritative.
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "default-src 'none'; sandbox");
  c.header('Cache-Control', 'private, no-store');
  return c.body(f.bytes as unknown as ArrayBuffer);
});
auditRoutes.delete('/files/:fileId', (c) => c.json(deleteFile(c.get('db'), c.get('ctx'), c.req.param('fileId'), tok(c))));

auditRoutes.get('/access', (c) => c.json({ users: listAccess(c.get('db'), c.get('ctx')) }));
auditRoutes.put('/access/:userId', async (c) => {
  const b = (await json(c)) as Record<string, unknown>;
  return c.json(setAccess(c.get('db'), c.get('ctx'), c.req.param('userId'), b.access));
});

auditRoutes.all('*', () => { throw notFound(); });
