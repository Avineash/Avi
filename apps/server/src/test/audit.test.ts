import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, allSteps, emptyCcRec } from '@staffhub/audit-core';
import { all, get, run, type DB } from '../db.ts';
import { freshApp, login, PNG, type Client } from './helpers.ts';

type App = ReturnType<typeof freshApp>['app'];
const DATE = '2031-06-10';
const steps = allSteps(DEFAULT_TEMPLATE).map((s) => s.step);
const PDF = Uint8Array.from(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'));

let db: DB, app: App;
const company = (slug: string) => get<{ id: string }>(db, 'SELECT id FROM companies WHERE slug = ?', slug)!.id;
const userBy = (slug: string, access: string) => get<{ email: string; property_id: string }>(db, 'SELECT email, property_id FROM users WHERE company_id = ? AND audit_access = ? ORDER BY email', company(slug), access)!;
const q = (propertyId: string, date = DATE) => `/api/audit/run?propertyId=${propertyId}&date=${date}`;

async function open(c: Client, propertyId: string, date = DATE) {
  const r = await c.send('POST', '/api/audit/run/open', { propertyId, date });
  expect(r.status).toBe(200);
  return (await r.json()) as any;
}
const lock = (token: string | null): Record<string, string> => (token ? { 'x-audit-lock': token } : {});

describe('night audit: access and tenant isolation', () => {
  let aurora: ReturnType<typeof userBy>, auditor: Client, manager: Client, meridianAdmin: Client, auroraAdmin: Client, employee: Client;
  beforeAll(async () => {
    ({ db, app } = freshApp());
    aurora = userBy('aurora', 'auditor');
    auditor = await login(app, aurora.email);
    manager = await login(app, userBy('aurora', 'manager').email);
    meridianAdmin = await login(app, 'admin@meridian.example');
    auroraAdmin = await login(app, 'admin@aurora.example');
    employee = await login(app, get<{ email: string }>(db, "SELECT email FROM users WHERE role = 'employee' AND audit_access IS NULL AND email LIKE '%@aurora.example' LIMIT 1")!.email);
  });

  it('is invisible to staff without audit access, and /me reports who has the module', async () => {
    expect((await employee.get('/api/audit/properties')).status).toBe(403);
    expect((await employee.get(q(aurora.property_id))).status).toBe(403);
    expect((await (await employee.get('/api/me')).json()).permissions.nightAudit).toBe(false);
    for (const c of [auditor, manager, auroraAdmin]) expect((await (await c.get('/api/me')).json()).permissions.nightAudit).toBe(true);
    expect((await (await auditor.get('/api/me')).json()).permissions.nightAuditRole).toBe('auditor');
  });

  it("another company's property, runs, files, summaries and templates are all 404", async () => {
    const mine = await open(auditor, aurora.property_id);
    const token = mine.lockToken;
    await auditor.send('PUT', `/api/audit/run/${mine.run.id}/step/${steps[0]!.id}`, { done: true }, lock(token));
    const up = await auditor.send('POST', `/api/audit/run/${mine.run.id}/files?step=${steps[0]!.id}`, PDF, { 'x-file-name': 'a.pdf', ...lock(token), 'content-type': 'application/octet-stream' });
    const fileId = (await up.json()).id;

    expect((await meridianAdmin.get(q(aurora.property_id))).status).toBe(404);
    expect((await meridianAdmin.get(`/api/audit/template?propertyId=${aurora.property_id}`)).status).toBe(404);
    expect((await meridianAdmin.get(`/api/audit/runs?propertyId=${aurora.property_id}`)).status).toBe(404);
    expect((await meridianAdmin.send('PUT', `/api/audit/template?propertyId=${aurora.property_id}`, { template: DEFAULT_TEMPLATE })).status).toBe(404);
    for (const path of [`/api/audit/run/${mine.run.id}/summary`, `/api/audit/run/${mine.run.id}/files`, `/api/audit/run/${mine.run.id}/ccrec`, `/api/audit/files/${fileId}`])
      expect((await meridianAdmin.get(path)).status, path).toBe(404);
    expect((await meridianAdmin.send('POST', `/api/audit/run/${mine.run.id}/reopen`)).status).toBe(404);
    expect((await meridianAdmin.send('DELETE', `/api/audit/files/${fileId}`, undefined, lock(token))).status).toBe(404);
    expect((await meridianAdmin.send('PUT', `/api/audit/run/${mine.run.id}/step/${steps[1]!.id}`, { done: true }, lock(token))).status).toBe(404);
    const ov = (await (await meridianAdmin.get(`/api/audit/overview?date=${DATE}`)).json()).properties as Array<{ propertyId: string }>;
    expect(ov.map((p) => p.propertyId)).not.toContain(aurora.property_id);
    // identical to a property that does not exist
    const ghost = await meridianAdmin.get(q('00000000-0000-4000-8000-000000000000'));
    expect(ghost.status).toBe(404);
  });

  it('property-bound staff cannot reach a sibling property of the same company', async () => {
    const other = get<{ id: string }>(db, 'SELECT id FROM properties WHERE company_id = ? AND id != ?', company('aurora'), aurora.property_id)!.id;
    expect((await auditor.get(q(other))).status).toBe(404);
    expect((await auditor.send('POST', '/api/audit/run/open', { propertyId: other, date: DATE })).status).toBe(404);
    const props = (await (await auditor.get('/api/audit/properties')).json()).properties;
    expect(props).toHaveLength(1);
    expect((await (await auroraAdmin.get('/api/audit/properties')).json()).properties).toHaveLength(2);
  });

  it('every returned audit row, file and summary belongs to the caller’s company, for every audit role', async () => {
    const accounts = all<{ email: string; company_id: string }>(db, 'SELECT email, company_id FROM users WHERE audit_access IS NOT NULL');
    expect(accounts.length).toBeGreaterThanOrEqual(9);
    for (const a of accounts) {
      const c = await login(app, a.email);
      const props = (await (await c.get('/api/audit/properties')).json()).properties as Array<{ id: string }>;
      for (const p of props) {
        expect(get<{ company_id: string }>(db, 'SELECT company_id FROM properties WHERE id = ?', p.id)!.company_id).toBe(a.company_id);
        for (const r of (await (await c.get(`/api/audit/runs?propertyId=${p.id}`)).json()).runs as Array<{ id: string }>)
          expect(get<{ company_id: string }>(db, 'SELECT company_id FROM audit_runs WHERE id = ?', r.id)!.company_id).toBe(a.company_id);
      }
    }
  });
});

describe('night audit: roles, steps and the edit lock', () => {
  let a: Client, b: Client, mgr: Client, pid: string, runId: string, tokenA: string;
  beforeAll(async () => {
    ({ db, app } = freshApp());
    const ua = userBy('aurora', 'auditor'), ub = userBy('aurora', 'both');
    pid = ua.property_id;
    a = await login(app, ua.email); b = await login(app, ub.email); mgr = await login(app, userBy('aurora', 'manager').email);
    const o = await open(a, pid);
    runId = o.run.id; tokenA = o.lockToken;
  });

  it('starting an audit snapshots the checklist and defaults the night auditor to the person starting', async () => {
    const r = await (await a.get(q(pid))).json();
    expect(r.exists).toBe(true);
    expect(r.run.nightAuditor).toBeTruthy();
    expect(r.run.businessDate).toBe('2031-06-11');
    expect(r.template.phases.length).toBe(DEFAULT_TEMPLATE.phases.length);
    expect(r.progress.done).toBe(0);
    expect(r.lock.heldByMe).toBe(false); // no token sent
    expect((await (await a.get(q(pid), { headers: { 'x-audit-lock': tokenA } })).json()).lock.heldByMe).toBe(true);
  });

  it('a night manager can view but not change anything', async () => {
    const r = await (await mgr.get(q(pid))).json();
    expect(r.exists).toBe(true);
    expect(r.canEdit).toBe(false);
    expect((await mgr.send('POST', '/api/audit/run/open', { propertyId: pid, date: '2031-06-12' })).status).toBe(403);
    expect((await mgr.send('PUT', `/api/audit/run/${runId}/step/${steps[0]!.id}`, { done: true }, lock(tokenA))).status).toBe(403);
    expect((await mgr.send('POST', `/api/audit/run/${runId}/takeover`)).status).toBe(403);
    expect((await mgr.send('PUT', `/api/audit/run/${runId}/meta`, { nightManager: 'x' }, lock(tokenA))).status).toBe(403);
  });

  it('ticking a step needs the lock token, stamps initials and moves progress', async () => {
    const path = `/api/audit/run/${runId}/step/${steps[0]!.id}`;
    expect((await a.send('PUT', path, { done: true })).status).toBe(409);
    const r = await a.send('PUT', path, { done: true }, lock(tokenA));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.state.done).toBe(true);
    expect(j.state.initials).toMatch(/^[A-Z]{1,4}$/);
    expect(j.progress.done).toBe(1);
    expect(j.progress.next.step.id).toBe(steps[1]!.id);
    // untick, notes, sub-tasks
    expect((await (await a.send('PUT', path, { done: false, note: 'rechecked' }, lock(tokenA))).json()).progress.done).toBe(0);
    const sub = steps.find((s) => s.subs)!;
    const sr = await (await a.send('PUT', `/api/audit/run/${runId}/step/${sub.id}`, { subs: [1, 0, 1] }, lock(tokenA))).json();
    expect(sr.state.subs).toEqual([0, 1]);
  });

  it('rejects malformed updates and unknown steps', async () => {
    const path = `/api/audit/run/${runId}/step/${steps[0]!.id}`;
    for (const bad of [{ done: 'yes' }, { initials: '12' }, { note: 'x'.repeat(1001) }, { subs: [99] }, { hack: 1 }])
      expect((await a.send('PUT', path, bad, lock(tokenA))).status).toBe(400);
    expect((await a.send('PUT', `/api/audit/run/${runId}/step/nope`, { done: true }, lock(tokenA))).status).toBe(404);
    expect((await a.get(q(pid, '2031-02-30'))).status).toBe(400);
    expect((await a.send('POST', '/api/audit/run/open', { propertyId: pid, date: 'tomorrow' })).status).toBe(400);
  });

  it('only one person edits at a time; the second sees who holds it, and may take over', async () => {
    const o = await open(b, pid);
    expect(o.lockToken).toBeNull();
    expect(o.lock.heldBy).toBeTruthy();
    expect(o.lock.heldByMe).toBe(false);
    const attempt = await b.send('PUT', `/api/audit/run/${runId}/step/${steps[2]!.id}`, { done: true });
    expect(attempt.status).toBe(409);
    expect((await attempt.json()).error.code).toBe('locked');

    const t = await b.send('POST', `/api/audit/run/${runId}/takeover`);
    expect(t.status).toBe(200);
    const tokenB = (await t.json()).lockToken as string;
    // the previous holder is cut off at their next write, with a clear code
    const cut = await a.send('PUT', `/api/audit/run/${runId}/step/${steps[2]!.id}`, { done: true }, lock(tokenA));
    expect(cut.status).toBe(409);
    expect((await cut.json()).error.code).toBe('locked');
    expect((await b.send('PUT', `/api/audit/run/${runId}/step/${steps[2]!.id}`, { done: true }, lock(tokenB))).status).toBe(200);
    expect((await b.send('POST', `/api/audit/run/${runId}/heartbeat`, undefined, lock(tokenB))).status).toBe(200);
    expect((await a.send('POST', `/api/audit/run/${runId}/heartbeat`, undefined, lock(tokenA))).status).toBe(409);
    // release frees it for anyone
    await b.send('POST', `/api/audit/run/${runId}/release`, undefined, lock(tokenB));
    const again = await open(a, pid);
    expect(again.lockToken).toBeTruthy();
    tokenA = again.lockToken;
  });

  it('a lock that stopped heartbeating can be acquired without a take-over; reopening your own replaces your token', async () => {
    run(db, 'UPDATE audit_runs SET lock_heartbeat = ? WHERE id = ?', new Date(Date.now() - 10 * 60_000).toISOString(), runId);
    const o = await open(b, pid);
    expect(o.lockToken).toBeTruthy();
    const again = await open(b, pid);
    expect(again.lockToken).not.toBe(o.lockToken);
    expect((await b.send('PUT', `/api/audit/run/${runId}/step/${steps[3]!.id}`, { done: true }, lock(o.lockToken))).status).toBe(409);
  });
});

describe('night audit: closing, reopening, summary', () => {
  let a: Client, adminOwn: Client, adminOther: Client, pid: string, id: string, token: string;
  beforeAll(async () => {
    ({ db, app } = freshApp());
    const ua = userBy('maison-verde', 'auditor');
    pid = ua.property_id;
    a = await login(app, ua.email);
    const prop = get<{ slug: string }>(db, 'SELECT slug FROM properties WHERE id = ?', pid)!.slug;
    adminOwn = await login(app, `${prop}.admin@maison-verde.example`);
    const otherSlug = get<{ slug: string }>(db, 'SELECT slug FROM properties WHERE company_id = ? AND id != ?', company('maison-verde'), pid)!.slug;
    adminOther = await login(app, `${otherSlug}.admin@maison-verde.example`);
    const o = await open(a, pid, '2031-07-01'); id = o.run.id; token = o.lockToken;
  });

  it('closing with steps outstanding needs an explicit, explained acknowledgement', async () => {
    let r = await a.send('POST', `/api/audit/run/${id}/close`, {}, lock(token));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('incomplete');
    expect((await a.send('POST', `/api/audit/run/${id}/close`, { acknowledgeIncomplete: true }, lock(token))).status).toBe(409);
    await a.send('PUT', `/api/audit/run/${id}/meta`, { nightAuditor: 'Pat Doe', nightManager: 'Sam Lee' }, lock(token));
    await a.send('PUT', `/api/audit/run/${id}/step/${steps[0]!.id}`, { done: true, initials: 'pd', note: 'All quiet' }, lock(token));
    r = await a.send('POST', `/api/audit/run/${id}/close`, { acknowledgeIncomplete: true, reason: 'Valet log unavailable' }, lock(token));
    expect(r.status).toBe(200);
    expect((await r.json()).incomplete).toBe(steps.length - 1);
  });

  it('a closed audit is read-only for everyone and records who closed it and why', async () => {
    const view = await (await a.get(q(pid, '2031-07-01'))).json();
    expect(view.run).toMatchObject({ status: 'closed', closeNote: 'Valet log unavailable' });
    expect(view.canEdit).toBe(false);
    expect(view.lock.heldBy).toBeNull();
    const w = await a.send('PUT', `/api/audit/run/${id}/step/${steps[1]!.id}`, { done: true }, lock(token));
    expect(w.status).toBe(409);
    expect((await w.json()).error.code).toBe('closed');
    expect((await a.send('POST', `/api/audit/run/${id}/takeover`)).status).toBe(409);
    expect((await a.send('POST', `/api/audit/run/${id}/reopen`)).status).toBe(403); // auditors cannot reopen
  });

  it('only an administrator of that property (or the company) can reopen', async () => {
    expect((await adminOther.send('POST', `/api/audit/run/${id}/reopen`)).status).toBe(404); // sibling property admin: not in scope
    expect((await adminOwn.send('POST', `/api/audit/run/${id}/reopen`)).status).toBe(200);
    expect((await adminOwn.send('POST', `/api/audit/run/${id}/reopen`)).status).toBe(409);
    expect((await (await a.get(q(pid, '2031-07-01'))).json()).run.status).toBe('open');
  });

  it('a complete audit closes without acknowledgement, and the summary reflects it', async () => {
    const o = await open(a, pid, '2031-07-02');
    for (const s of steps) await a.send('PUT', `/api/audit/run/${o.run.id}/step/${s.id}`, { done: true }, lock(o.lockToken));
    const cc = emptyCcRec(); cc.rows[0] = { card: 'Visa', pms: 5000, terminalFo: 5000, terminalFb: 0 };
    expect((await a.send('PUT', `/api/audit/run/${o.run.id}/ccrec`, cc, lock(o.lockToken))).status).toBe(200);
    expect((await a.send('POST', `/api/audit/run/${o.run.id}/close`, {}, lock(o.lockToken))).status).toBe(200);
    const text = (await (await adminOwn.get(`/api/audit/run/${o.run.id}/summary`)).json()).text as string;
    expect(text).toContain(`${steps.length}/${steps.length} steps (100%)`);
    expect(text).toContain('CLOSED');
    expect(text).toContain('balanced');
    const runs = (await (await adminOwn.get(`/api/audit/runs?propertyId=${pid}`)).json()).runs as any[];
    expect(runs.find((r) => r.auditDate === '2031-07-02')).toMatchObject({ status: 'closed', percent: 100 });
    const ov = (await (await adminOwn.get('/api/audit/overview?date=2031-07-02')).json()).properties as any[];
    expect(ov).toHaveLength(1);
    expect(ov[0]).toMatchObject({ status: 'closed', percent: 100 });
    const ovCompany = (await (await (await login(app, 'admin@maison-verde.example')).get('/api/audit/overview?date=2031-07-02')).json()).properties as any[];
    expect(ovCompany.map((p) => p.status).sort()).toEqual(['closed', 'not_started']);
  });
});

describe('night audit: checklist template', () => {
  it('administrators version it; invalid templates are refused; running audits keep the checklist they started with', async () => {
    ({ db, app } = freshApp());
    const ua = userBy('aurora', 'auditor'), pid = ua.property_id;
    const a = await login(app, ua.email);
    const prop = get<{ slug: string }>(db, 'SELECT slug FROM properties WHERE id = ?', pid)!.slug;
    const admin = await login(app, `${prop}.admin@aurora.example`);
    const before = await open(a, pid, '2031-08-01');
    expect(before.template.name).toBe('Standard night audit');

    expect((await a.send('PUT', `/api/audit/template?propertyId=${pid}`, { template: DEFAULT_TEMPLATE })).status).toBe(403);
    const bad = await admin.send('PUT', `/api/audit/template?propertyId=${pid}`, { template: { name: '<b>x</b>', phases: [] } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.errors.length).toBeGreaterThan(0);

    const custom = { ...DEFAULT_TEMPLATE, name: 'Harbour night audit', phases: DEFAULT_TEMPLATE.phases.slice(0, 2) };
    expect((await (await admin.send('PUT', `/api/audit/template?propertyId=${pid}`, { template: custom })).json()).version).toBe(1);
    expect((await (await admin.send('PUT', `/api/audit/template?propertyId=${pid}`, { template: { ...custom, name: 'v2' } })).json()).version).toBe(2);

    const still = await (await a.get(q(pid, '2031-08-01'))).json();
    expect(still.template.name).toBe('Standard night audit'); // snapshot unaffected
    const fresh = await open(a, pid, '2031-08-02');
    expect(fresh.template.name).toBe('v2');
    expect(fresh.progress.total).toBeLessThan(still.progress.total);
    expect(fresh.run.templateVersion).toBe(2);

    // the sibling property still uses the default
    const sibling = get<{ id: string }>(db, 'SELECT id FROM properties WHERE company_id = ? AND id != ?', company('aurora'), pid)!.id;
    expect((await (await (await login(app, 'admin@aurora.example')).get(`/api/audit/template?propertyId=${sibling}`)).json()).version).toBe(0);
  });
});

describe('night audit: report files', () => {
  let a: Client, runId: string, token: string, other: Client;
  const up = (c: Client, id: string, tk: string | null, name: string, body: Uint8Array | string, step = steps[0]!.id) =>
    c.send('POST', `/api/audit/run/${id}/files?step=${step}`, body, { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream', ...lock(tk) });
  beforeAll(async () => {
    ({ db, app } = freshApp());
    const ua = userBy('aurora', 'auditor');
    a = await login(app, ua.email); other = await login(app, userBy('aurora', 'both').email);
    const o = await open(a, ua.property_id, '2031-09-01'); runId = o.run.id; token = o.lockToken;
  });

  it('accepts real report files, names them safely, and serves them as downloads only', async () => {
    const r = await up(a, runId, token, '../../etc/Income Audit <final>.pdf', PDF);
    expect(r.status).toBe(201);
    const f = await r.json();
    expect(f.name).toBe('Income Audit final.pdf');
    expect(f.mime).toBe('application/pdf');
    expect((await up(a, runId, token, 'shot.png', PNG)).status).toBe(201);
    expect((await up(a, runId, token, 'rec.csv', 'a,b\n1,2\n')).status).toBe(201);
    const dl = await other.get(`/api/audit/files/${f.id}`); // another auditor of the same property may read it
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('content-security-policy')).toContain('sandbox');
    const list = (await (await a.get(`/api/audit/run/${runId}/files`)).json()).files as any[];
    expect(list).toHaveLength(3);
    expect(new Date(list[0].expiresAt).getTime() - new Date(list[0].createdAt).getTime()).toBe(7 * 86_400_000);
    expect((await (await a.get(q(get<{ property_id: string }>(db, 'SELECT property_id FROM audit_runs WHERE id = ?', runId)!.property_id, '2031-09-01'))).json()).fileCounts[steps[0]!.id]).toBe(3);
  });

  it('refuses disguised, dangerous, empty, oversized and lock-less uploads', async () => {
    expect((await up(a, runId, token, 'evil.pdf', '<html><script>alert(1)</script></html>')).status).toBe(415);
    expect((await up(a, runId, token, 'x.png', 'not really a png')).status).toBe(415);
    expect((await up(a, runId, token, 'run.exe', Uint8Array.from([0x4d, 0x5a, 0x90, 0]))).status).toBe(415);
    expect((await up(a, runId, token, 'macro.xlsm', Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).status).toBe(415);
    expect((await up(a, runId, token, 'e.pdf', new Uint8Array(0))).status).toBe(400);
    expect((await up(a, runId, token, 'big.pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46, ...new Uint8Array(5 * 1024 * 1024 + 10)]))).status).toBe(413);
    expect((await up(a, runId, null, 'ok.pdf', PDF)).status).toBe(409);
    expect((await up(other, runId, token, 'ok.pdf', PDF)).status).toBe(409); // someone else's token is not enough without being the holder
    expect((await up(a, runId, token, 'ok.pdf', PDF, 'no-such-step')).status).toBe(404);
  });

  it('deletes with the lock, and expires after seven days', async () => {
    const f = (await (await a.get(`/api/audit/run/${runId}/files`)).json()).files[0];
    expect((await a.send('DELETE', `/api/audit/files/${f.id}`)).status).toBe(409);
    expect((await a.send('DELETE', `/api/audit/files/${f.id}`, undefined, lock(token))).status).toBe(200);
    expect((await a.get(`/api/audit/files/${f.id}`)).status).toBe(404);
    run(db, 'UPDATE audit_files SET created_at = ?', new Date(Date.now() - 8 * 86_400_000).toISOString());
    expect(((await (await a.get(`/api/audit/run/${runId}/files`)).json()).files as any[])).toHaveLength(0);
  });
});

describe('night audit: card reconciliation tool', () => {
  it('saves per run, recomputable, and needs the lock', async () => {
    ({ db, app } = freshApp());
    const ua = userBy('meridian', 'auditor');
    const a = await login(app, ua.email);
    const o = await open(a, ua.property_id, '2031-10-01');
    const get1 = await (await a.get(`/api/audit/run/${o.run.id}/ccrec`)).json();
    expect(get1.data.rows.length).toBe(6);
    const data = { ...get1.data, tolerance: 100, note: 'Terminal 2 settled late' };
    data.rows[0] = { card: 'Visa', pms: 10_000, terminalFo: 6_000, terminalFb: 3_950 };
    expect((await a.send('PUT', `/api/audit/run/${o.run.id}/ccrec`, data)).status).toBe(409);
    expect((await a.send('PUT', `/api/audit/run/${o.run.id}/ccrec`, data, lock(o.lockToken))).status).toBe(200);
    expect((await (await a.get(`/api/audit/run/${o.run.id}/ccrec`)).json()).data).toEqual(data);
    for (const bad of [{ ...data, tolerance: -5 }, { ...data, rows: [{ card: 'V', pms: 1.5, terminalFo: 0, terminalFb: 0 }] }, { ...data, hack: 1 }])
      expect((await a.send('PUT', `/api/audit/run/${o.run.id}/ccrec`, bad, lock(o.lockToken))).status).toBe(400);
  });
});

describe('night audit: who has access', () => {
  it('property administrators grant roles within their property; company administrators anywhere in the company; never across tenants', async () => {
    ({ db, app } = freshApp());
    const parisAdmin = await login(app, 'paris.admin@maison-verde.example');
    const lisbonUser = get<{ id: string }>(db, "SELECT u.id FROM users u JOIN properties p ON p.id = u.property_id WHERE p.slug = 'lisbon' AND u.role = 'employee' AND u.audit_access IS NULL LIMIT 1")!.id;
    const parisUser = get<{ id: string }>(db, "SELECT u.id FROM users u JOIN properties p ON p.id = u.property_id WHERE p.slug = 'paris' AND u.role = 'employee' AND u.audit_access IS NULL LIMIT 1")!.id;
    const list = (await (await parisAdmin.get('/api/audit/access')).json()).users as any[];
    expect(list.every((u) => u.property === 'Maison Verde Paris')).toBe(true);
    expect((await parisAdmin.send('PUT', `/api/audit/access/${parisUser}`, { access: 'auditor' })).status).toBe(200);
    expect((await parisAdmin.send('PUT', `/api/audit/access/${lisbonUser}`, { access: 'auditor' })).status).toBe(404);
    expect((await parisAdmin.send('PUT', `/api/audit/access/${parisUser}`, { access: 'owner' })).status).toBe(400);

    const granted = await login(app, get<{ email: string }>(db, 'SELECT email FROM users WHERE id = ?', parisUser)!.email);
    expect((await granted.get('/api/audit/properties')).status).toBe(200);
    expect((await parisAdmin.send('PUT', `/api/audit/access/${parisUser}`, { access: null })).status).toBe(200);
    expect((await granted.get('/api/audit/properties')).status).toBe(403);

    const co = await login(app, 'admin@maison-verde.example');
    expect((await co.send('PUT', `/api/audit/access/${lisbonUser}`, { access: 'manager' })).status).toBe(200);
    expect((await (await co.get('/api/audit/access')).json()).users.length).toBeGreaterThan(list.length);
    const meridianUser = get<{ id: string }>(db, "SELECT id FROM users WHERE email LIKE '%@meridian.example' AND role='employee' LIMIT 1")!.id;
    expect((await co.send('PUT', `/api/audit/access/${meridianUser}`, { access: 'auditor' })).status).toBe(404);
    const companyAdminId = get<{ id: string }>(db, "SELECT id FROM users WHERE email = 'admin@maison-verde.example'")!.id;
    expect((await co.send('PUT', `/api/audit/access/${companyAdminId}`, { access: 'auditor' })).status).toBe(400); // no property
    // workers cannot grant themselves anything
    const worker = await login(app, userBy('maison-verde', 'auditor').email);
    expect((await worker.get('/api/audit/access')).status).toBe(403);
    expect((await worker.send('PUT', `/api/audit/access/${parisUser}`, { access: 'both' })).status).toBe(403);
  });
});

describe('workforce data is untouched by night-audit activity', () => {
  it('leave, roster and notifications are identical before and after audits are run and closed', async () => {
    ({ db, app } = freshApp());
    const tables = ['users', 'leave_requests', 'roster_shifts', 'notifications', 'departments', 'properties'];
    const snap = () => JSON.stringify(tables.map((t) => all(db, `SELECT * FROM ${t} ORDER BY 1`)));
    const before = snap();
    const ua = userBy('aurora', 'auditor');
    const a = await login(app, ua.email);
    const o = await open(a, ua.property_id, '2031-11-01');
    for (const s of steps) await a.send('PUT', `/api/audit/run/${o.run.id}/step/${s.id}`, { done: true }, lock(o.lockToken));
    await a.send('POST', `/api/audit/run/${o.run.id}/close`, {}, lock(o.lockToken));
    expect(snap()).toBe(before);
  });
});
