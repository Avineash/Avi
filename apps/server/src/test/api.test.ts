import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { all, get, type DB } from '../db.ts';
import { countWorkingDays } from '../leave.ts';
import { shiftHours } from '../roster.ts';
import { freshApp, ids, login, PNG, type Client } from './helpers.ts';

type App = ReturnType<typeof freshApp>['app'];

describe('authentication & CSRF', () => {
  const { app } = freshApp();
  it('rejects unauthenticated access', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
    expect((await app.request('/api/leave')).status).toBe(401);
    expect((await app.request('/api/brand/scopes')).status).toBe(401);
  });
  it('rejects bad credentials with a generic message', async () => {
    const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'staffhub' }, body: JSON.stringify({ email: 'admin@aurora.example', password: 'nope' }) });
    expect(r.status).toBe(401);
    const r2 = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'staffhub' }, body: JSON.stringify({ email: 'ghost@nowhere.example', password: 'nope' }) });
    expect((await r.json()).error.message).toBe((await r2.json()).error.message);
  });
  it('requires the CSRF header on state-changing requests, even with a valid session', async () => {
    const login1 = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'staffhub' }, body: JSON.stringify({ email: 'admin@aurora.example', password: 'staffhub-demo' }) });
    const cookie = login1.headers.get('set-cookie')!.split(';')[0]!;
    const forged = await app.request('/api/leave', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    expect(forged.status).toBe(403);
    expect((await forged.json()).error.code).toBe('csrf');
    // login itself is also protected
    expect((await app.request('/api/auth/login', { method: 'POST', body: '{}' })).status).toBe(403);
    // safe methods are unaffected
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(200);
  });
  it('sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'staffhub' }, body: JSON.stringify({ email: 'admin@aurora.example', password: 'staffhub-demo' }) });
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe('tenant isolation', () => {
  let db: DB, app: App;
  let aurora: Client, meridian: Client, maison: Client;
  beforeAll(async () => {
    ({ db, app } = freshApp());
    aurora = await login(app, 'admin@aurora.example');
    meridian = await login(app, 'admin@meridian.example');
    maison = await login(app, 'admin@maison-verde.example');
  });

  const companyOf = (table: string, id: string) => get<{ company_id: string }>(db, `SELECT company_id FROM ${table} WHERE id = ?`, id)?.company_id;
  const companyId = (slug: string) => get<{ id: string }>(db, 'SELECT id FROM companies WHERE slug = ?', slug)!.id;

  it('every role in every company only ever receives rows from its own company', async () => {
    const accounts = all<{ email: string; company_id: string }>(db,
      `SELECT email, company_id FROM users WHERE id IN (SELECT MIN(id) FROM users GROUP BY company_id, role)`);
    expect(accounts.length).toBeGreaterThanOrEqual(12);
    for (const a of accounts) {
      const c = await login(app, a.email);
      const leave = (await c.json(await c.get('/api/leave'))).leave as Array<{ id: string }>;
      for (const l of leave) expect(companyOf('leave_requests', l.id)).toBe(a.company_id);
      const emps = (await c.json(await c.get('/api/employees'))).employees as Array<{ id: string }>;
      for (const e of emps) expect(companyOf('users', e.id)).toBe(a.company_id);
      const roster = await c.json(await c.get('/api/roster'));
      for (const s of roster.shifts) expect(companyOf('roster_shifts', s.id)).toBe(a.company_id);
      for (const p of roster.people) expect(companyOf('users', p.id)).toBe(a.company_id);
      const notes = (await c.json(await c.get('/api/notifications'))).notifications as Array<{ id: string }>;
      for (const n of notes) expect(companyOf('notifications', n.id)).toBe(a.company_id);
    }
  });

  it("another company's leave request is a 404 for read, approve, reject and cancel (no existence oracle)", async () => {
    const foreign = ids(db, 'SELECT id FROM leave_requests WHERE company_id = ? AND status = ? LIMIT 3', companyId('aurora'), 'pending');
    expect(foreign.length).toBeGreaterThan(0);
    for (const id of foreign) {
      expect((await meridian.send('POST', `/api/leave/${id}/decision`, { decision: 'approved' })).status).toBe(404);
      expect((await meridian.send('POST', `/api/leave/${id}/cancel`)).status).toBe(404);
    }
    const missing = await meridian.send('POST', '/api/leave/00000000-0000-4000-8000-000000000000/decision', { decision: 'approved' });
    const real = await meridian.send('POST', `/api/leave/${foreign[0]}/decision`, { decision: 'approved' });
    expect(real.status).toBe(missing.status);
    expect(await real.json()).toEqual(await missing.json());
    // and the data was not touched
    expect(get<{ status: string }>(db, 'SELECT status FROM leave_requests WHERE id = ?', foreign[0]!)!.status).toBe('pending');
  });

  it("cannot read another company's roster by guessing a property id", async () => {
    const harbour = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug = 'harbour'")!.id;
    expect((await meridian.get(`/api/roster?propertyId=${harbour}`)).status).toBe(404);
  });

  it("cannot read or write another company's brand scope, versions or assets", async () => {
    const harbour = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug = 'harbour'")!.id;
    for (const [m, p, b] of [['GET', `/api/brand/scope/${harbour}`], ['PUT', `/api/brand/scope/${harbour}/draft`, { config: {}, baseRevision: 0 }],
      ['DELETE', `/api/brand/scope/${harbour}/draft`], ['POST', `/api/brand/scope/${harbour}/publish`, { baseRevision: 0 }],
      ['GET', `/api/brand/scope/${harbour}/versions`], ['POST', `/api/brand/scope/${harbour}/rollback`, { version: 1 }]] as const) {
      expect((await meridian.send(m, p, b)).status, `${m} ${p}`).toBe(404);
    }
    // referencing another tenant's uploaded logo in your own draft is rejected
    const auroraLogo = get<{ id: string }>(db, "SELECT id FROM brand_assets WHERE company_id = ? AND kind = 'logo'", companyId('aurora'))!.id;
    const state = await meridian.json(await meridian.get('/api/brand/scope/company'));
    const res = await meridian.send('PUT', '/api/brand/scope/company/draft', { config: { identity: { logoAssetId: auroraLogo } }, baseRevision: state.draft.revision });
    expect(res.status).toBe(400);
  });

  it("a company's theme is only visible to its own users; each company has its own theme at the same time", async () => {
    const a = await aurora.json(await aurora.get('/api/theme'));
    const m = await maison.json(await maison.get('/api/theme'));
    const x = await meridian.json(await meridian.get('/api/theme'));
    expect(new Set([a.fingerprint, m.fingerprint, x.fingerprint]).size).toBe(3);
    expect(a.config.identity.companyName).toBe('Aurora Hotels Group');
    expect(m.config.identity.companyName).toBe('Maison Verde Collection');
    expect(x.config.typography.headingFont).toBe('playfair-display');
    expect(m.config.typography.headingFont).toBe('cormorant');
  });

  it('dashboards only count the caller’s own tenant', async () => {
    const d = await meridian.json(await meridian.get('/api/dashboard'));
    const n = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM users WHERE company_id = ?', companyId('meridian'))!.n;
    expect(d.headcount).toBe(n);
  });
});

describe('role scoping & leave workflow', () => {
  let db: DB, app: App;
  beforeAll(() => { ({ db, app } = freshApp()); });

  it('employees see only their own requests; managers their department; property admins their property', async () => {
    const emp = get<{ email: string; id: string; department_id: string; property_id: string }>(db, "SELECT * FROM users WHERE role = 'employee' AND email LIKE '%@aurora.example' LIMIT 1")!;
    const e = await login(app, emp.email);
    const own = (await e.json(await e.get('/api/leave'))).leave as Array<{ employeeId: string }>;
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((l) => l.employeeId === emp.id)).toBe(true);

    const mgr = get<{ email: string }>(db, "SELECT email FROM users WHERE role = 'manager' AND department_id = ?", emp.department_id)!;
    const m = await login(app, mgr.email);
    const dept = (await m.json(await m.get('/api/leave'))).leave as Array<{ id: string }>;
    for (const l of dept) expect(get<{ department_id: string }>(db, 'SELECT department_id FROM leave_requests WHERE id = ?', l.id)!.department_id).toBe(emp.department_id);

    const pa = get<{ email: string }>(db, "SELECT email FROM users WHERE role = 'property_admin' AND property_id = ?", emp.property_id)!;
    const p = await login(app, pa.email);
    const prop = (await p.json(await p.get('/api/leave'))).leave as Array<{ id: string }>;
    expect(prop.length).toBeGreaterThan(dept.length);
    for (const l of prop) expect(get<{ property_id: string }>(db, 'SELECT property_id FROM leave_requests WHERE id = ?', l.id)!.property_id).toBe(emp.property_id);
  });

  it('employees cannot approve; nobody can approve their own request; managers decide within their department and the employee is notified', async () => {
    const pending = get<{ id: string; employee_id: string; department_id: string }>(db, "SELECT * FROM leave_requests WHERE status = 'pending' AND company_id = (SELECT id FROM companies WHERE slug='aurora') LIMIT 1")!;
    const emp = get<{ email: string }>(db, 'SELECT email FROM users WHERE id = ?', pending.employee_id)!;
    const e = await login(app, emp.email);
    expect((await e.send('POST', `/api/leave/${pending.id}/decision`, { decision: 'approved' })).status).toBe(403);

    const mgrRow = get<{ id: string; email: string }>(db, "SELECT id, email FROM users WHERE role='manager' AND department_id = ?", pending.department_id)!;
    const m = await login(app, mgrRow.email);
    const res = await m.send('POST', `/api/leave/${pending.id}/decision`, { decision: 'approved' });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('approved');
    expect((await m.send('POST', `/api/leave/${pending.id}/decision`, { decision: 'rejected' })).status).toBe(409); // already decided
    const notes = (await e.json(await e.get('/api/notifications'))).notifications as Array<{ status: string; title: string }>;
    expect(notes.some((n) => n.status === 'approved' && n.title === 'Leave approved')).toBe(true);

    // a manager cannot approve their own request
    const mine = await m.json(await m.send('POST', '/api/leave', { type: 'Annual leave', startDate: '2031-03-03', endDate: '2031-03-05' }));
    expect(mine.status).toBe('pending');
    expect((await m.send('POST', `/api/leave/${mine.id}/decision`, { decision: 'approved' })).status).toBe(403);
  });

  it('validates requests: dates, weekends-only ranges and overlaps', async () => {
    const e = await login(app, get<{ email: string }>(db, "SELECT email FROM users WHERE role='employee' LIMIT 1")!.email);
    expect((await e.send('POST', '/api/leave', { type: 'Annual leave', startDate: '2031-05-10', endDate: '2031-05-09' })).status).toBe(400);
    expect((await e.send('POST', '/api/leave', { type: 'Annual leave', startDate: '2031-05-10', endDate: '2031-05-11' })).status).toBe(400); // Sat–Sun
    expect((await e.send('POST', '/api/leave', { type: 'Nonsense', startDate: '2031-05-12', endDate: '2031-05-13' })).status).toBe(400);
    expect((await e.send('POST', '/api/leave', { type: 'Annual leave', startDate: '2031-05-12', endDate: '2031-05-13' })).status).toBe(201);
    expect((await e.send('POST', '/api/leave', { type: 'Annual leave', startDate: '2031-05-13', endDate: '2031-05-14' })).status).toBe(409);
  });

  it('business-rule helpers are pure', () => {
    expect(countWorkingDays('2031-05-12', '2031-05-18')).toBe(5);
    expect(countWorkingDays('2031-05-10', '2031-05-11')).toBe(0);
    expect(shiftHours('06:00', '14:00')).toBe(8);
    expect(shiftHours('22:00', '06:00')).toBe(8);
  });
});

describe('brand management: permissions & delegation', () => {
  let app: App, db: DB;
  beforeAll(() => { ({ app, db } = freshApp()); });

  it('employees and managers cannot reach Brand & Appearance', async () => {
    for (const role of ['employee', 'manager']) {
      const c = await login(app, get<{ email: string }>(db, 'SELECT email FROM users WHERE role = ? LIMIT 1', role)!.email);
      expect((await c.get('/api/brand/scopes')).status).toBe(403);
      expect((await c.send('PUT', '/api/brand/scope/company/draft', { config: {}, baseRevision: 0 })).status).toBe(403);
    }
  });

  it('company admins manage the company and every property; property admins only their own property', async () => {
    const admin = await login(app, 'admin@maison-verde.example');
    const scopes = (await admin.json(await admin.get('/api/brand/scopes'))).scopes as Array<{ key: string }>;
    expect(scopes.map((s) => s.key)).toContain('company');
    expect(scopes).toHaveLength(3);

    const paris = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug='paris'")!.id;
    const lisbon = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug='lisbon'")!.id;
    const pa = await login(app, 'paris.admin@maison-verde.example');
    const mine = (await pa.json(await pa.get('/api/brand/scopes'))).scopes as Array<{ key: string }>;
    expect(mine.map((s) => s.key)).toEqual([paris]);
    expect((await pa.get(`/api/brand/scope/${lisbon}`)).status).toBe(403); // same company, different property
    expect((await pa.get('/api/brand/scope/company')).status).toBe(403);
    expect((await pa.get(`/api/brand/scope/${paris}`)).status).toBe(200);
  });

  it('property overrides are limited by the company policy, and the policy can be widened only by a company admin', async () => {
    const paris = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug='paris'")!.id;
    const pa = await login(app, 'paris.admin@maison-verde.example');
    const admin = await login(app, 'admin@maison-verde.example');
    let state = await pa.json(await pa.get(`/api/brand/scope/${paris}`));
    expect(state.editable).toMatchObject({ identity: true, colors: false, status: false });

    // identity is allowed by default…
    let res = await pa.send('PUT', `/api/brand/scope/${paris}/draft`, { config: { identity: { tagline: 'Rive Gauche' } }, baseRevision: state.draft.revision });
    expect(res.status).toBe(200);
    // …colours are not
    state = await pa.json(await pa.get(`/api/brand/scope/${paris}`));
    res = await pa.send('PUT', `/api/brand/scope/${paris}/draft`, { config: { colors: { light: { primary: '#aa3355' } } }, baseRevision: state.draft.revision });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('policy_violation');

    expect((await pa.send('PUT', '/api/brand/policy', { policy: { colors: true } })).status).toBe(403);
    expect((await admin.send('PUT', '/api/brand/policy', { policy: { identity: true, colors: true } })).status).toBe(200);

    state = await pa.json(await pa.get(`/api/brand/scope/${paris}`));
    expect(state.editable.colors).toBe(true);
    res = await pa.send('PUT', `/api/brand/scope/${paris}/draft`, { config: { colors: { light: { primary: '#aa3355' } } }, baseRevision: state.draft.revision });
    expect(res.status).toBe(200);
  });
});

describe('draft → preview → publish → rollback', () => {
  let app: App, db: DB, admin: Client, staff: Client, other: Client;
  const theme = async (c: Client) => (await c.json(await c.get('/api/theme'))) as { fingerprint: string; config: any };
  const state = async (scope = 'company') => (await admin.json(await admin.get(`/api/brand/scope/${scope}`))) as any;

  beforeAll(async () => {
    ({ app, db } = freshApp());
    admin = await login(app, 'admin@aurora.example');
    staff = await login(app, get<{ email: string }>(db, "SELECT email FROM users WHERE role='employee' AND email LIKE '%@aurora.example' LIMIT 1")!.email);
    other = await login(app, 'admin@meridian.example');
  });

  it('saving a draft does not change what anyone sees', async () => {
    const before = await theme(staff);
    const adminBefore = await theme(admin);
    const s = await state();
    const res = await admin.send('PUT', '/api/brand/scope/company/draft', { config: { ...s.draft.config, colors: { ...s.draft.config.colors, light: { ...s.draft.config.colors.light, primary: '#7a1fa2' } } }, baseRevision: s.draft.revision });
    expect(res.status).toBe(200);
    expect((await res.json()).hasUnpublishedChanges).toBe(true);
    expect((await theme(staff)).fingerprint).toBe(before.fingerprint);
    expect((await theme(admin)).fingerprint).toBe(adminBefore.fingerprint);
    const pub = await (await app.request('/api/public/brand?company=aurora')).json();
    expect(pub.config.colors.light.primary).not.toBe('#7a1fa2');
  });

  it('rejects stale revisions (two admins editing at once)', async () => {
    const s = await state();
    const res = await admin.send('PUT', '/api/brand/scope/company/draft', { config: s.draft.config, baseRevision: s.draft.revision - 1 });
    expect(res.status).toBe(409);
    expect((await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: s.draft.revision - 1 })).status).toBe(409);
  });

  it('publishing makes the new theme live for that company’s users only, in a fresh session too', async () => {
    const otherBefore = await theme(other);
    const s = await state();
    const res = await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: s.draft.revision, note: 'Purple experiment' });
    expect(res.status).toBe(201);
    const { version } = await res.json();
    expect(version).toBe(3);
    expect((await theme(staff)).config.colors.light.primary).toBe('#7a1fa2');
    expect((await theme(other)).fingerprint).toBe(otherBefore.fingerprint);

    const fresh = await login(app, staff.email); // new session ≈ new device
    expect((await theme(fresh)).config.colors.light.primary).toBe('#7a1fa2');
    const me = await fresh.json(await fresh.get('/api/me'));
    expect(me.theme.config.colors.light.primary).toBe('#7a1fa2');
  });

  it('supports ETag revalidation', async () => {
    const r = await staff.get('/api/theme');
    const etag = r.headers.get('etag')!;
    expect((await staff.get('/api/theme', { headers: { 'if-none-match': etag } })).status).toBe(304);
  });

  it('refuses to publish when there is nothing new', async () => {
    const s = await state();
    const res = await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: s.draft.revision });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('nothing_to_publish');
  });

  it('keeps full history and can restore any earlier version as a new version', async () => {
    const vs = (await admin.json(await admin.get('/api/brand/scope/company/versions'))).versions as any[];
    expect(vs.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(vs[0].active).toBe(true);
    expect(vs[0].note).toBe('Purple experiment');
    expect(vs[0].summary.map((x: any) => x.group)).toEqual(['colors']);

    const rb = await admin.send('POST', '/api/brand/scope/company/rollback', { version: 2 });
    expect(rb.status).toBe(201);
    expect((await rb.json())).toMatchObject({ version: 4, restoredFrom: 2 });
    expect((await theme(staff)).config.colors.light.primary).toBe('#0f5c5a'); // premium-hospitality teal is back
    const after = (await admin.json(await admin.get('/api/brand/scope/company/versions'))).versions as any[];
    expect(after.map((v) => v.version)).toEqual([4, 3, 2, 1]); // nothing was deleted or rewritten
    expect(after[0]).toMatchObject({ kind: 'rollback', restoredFrom: 2, active: true });
    expect((await admin.send('POST', '/api/brand/scope/company/rollback', { version: 4 })).status).toBe(400); // already active
    expect((await admin.send('POST', '/api/brand/scope/company/rollback', { version: 99 })).status).toBe(404);

    // the purple version is still retrievable and can be restored again
    const v3 = await admin.json(await admin.get('/api/brand/scope/company/versions/3'));
    expect(v3.config.colors.light.primary).toBe('#7a1fa2');
  });

  it('discarding a draft returns to the published theme', async () => {
    let s = await state();
    await admin.send('PUT', '/api/brand/scope/company/draft', { config: { ...s.draft.config, shape: { radius: 'pill', density: 'compact' } }, baseRevision: s.draft.revision });
    s = await state();
    expect(s.draft.hasUnpublishedChanges).toBe(true);
    expect((await admin.send('DELETE', '/api/brand/scope/company/draft')).status).toBe(200);
    s = await state();
    expect(s.draft.hasUnpublishedChanges).toBe(false);
    expect(s.draft.config.shape.radius).not.toBe('pill');
  });

  it('inheritance: properties follow company publishes until they override; drafts of the parent never leak', async () => {
    const harbour = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug='harbour'")!.id;
    const alpine = get<{ id: string }>(db, "SELECT id FROM properties WHERE slug='alpine'")!.id;
    const u = (slug: string) => login(app, get<{ email: string }>(db, `SELECT u.email FROM users u JOIN properties p ON p.id = u.property_id WHERE p.slug = ? AND u.role = 'employee' LIMIT 1`, slug)!.email);
    const harbourUser = await u('harbour'), alpineUser = await u('alpine');

    const h = await theme(harbourUser), a = await theme(alpineUser);
    expect(h.config.identity.propertyName).toBe('Aurora Harbour Hotel'); // default from the property record
    expect(h.config.identity.companyName).toBe('Aurora Hotels Group');
    expect(h.config.colors.light.primary).toBe('#0f5c5a'); // inherited from company
    expect(a.config.colors.light.primary).toBe('#2f5d3a'); // Alpine's override wins

    // company publishes a new accent → Harbour (no override) follows; Alpine inherits the accent but keeps its primary
    let s = await state();
    await admin.send('PUT', '/api/brand/scope/company/draft', { config: { ...s.draft.config, colors: { ...s.draft.config.colors, light: { ...s.draft.config.colors.light, accent: '#8a4b00' } } }, baseRevision: s.draft.revision });
    expect((await theme(harbourUser)).config.colors.light.accent).not.toBe('#8a4b00'); // still a draft
    s = await state();
    expect((await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: s.draft.revision })).status).toBe(201);
    expect((await theme(harbourUser)).config.colors.light.accent).toBe('#8a4b00');
    const a2 = await theme(alpineUser);
    expect(a2.config.colors.light.accent).toBe('#8a4b00');
    expect(a2.config.colors.light.primary).toBe('#2f5d3a');

    // the property editor shows what it inherits (company published layer)
    const ps = await state(alpine);
    expect(ps.scope.type).toBe('property');
    expect(ps.inheritedLayers[0].colors.light.accent).toBe('#8a4b00');
    void harbour;
  });

  it('rejects a company-level property name', async () => {
    const s = await state();
    const res = await admin.send('PUT', '/api/brand/scope/company/draft', { config: { identity: { propertyName: 'X' } }, baseRevision: s.draft.revision });
    expect(res.status).toBe(400);
  });
});

describe('accessibility gate on publish', () => {
  let app: App, admin: Client;
  const draft = async (mutate: (c: any) => any) => {
    const s = await admin.json(await admin.get('/api/brand/scope/company'));
    const config = mutate(structuredClone(s.draft.config));
    const r = await admin.send('PUT', '/api/brand/scope/company/draft', { config, baseRevision: s.draft.revision });
    expect(r.status).toBe(200);
    return (await r.json()).revision as number;
  };
  beforeAll(async () => { ({ app } = freshApp()); admin = await login(app, 'admin@aurora.example'); });

  it('blocks low-contrast leave status colours outright, even if the admin acknowledges', async () => {
    const rev = await draft((c) => ({ ...c, status: { approved: { light: { bg: '#dff5e6', fg: '#9bd8b0' } } } }));
    const res = await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: rev, acknowledgeAccessibility: true });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('accessibility_blocking');
    expect(body.error.report.blocking[0].id).toBe('status-approved:light');
    expect(body.error.report.blocking[0].fix.value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('requires explicit acknowledgement for other contrast failures, and records it', async () => {
    const rev = await draft((c) => ({ ...c, status: undefined, colors: { ...c.colors, light: { ...c.colors.light, text: '#aaaaaa' } } }));
    let res = await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: rev });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('accessibility_ack_required');
    res = await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: rev, acknowledgeAccessibility: true, note: 'Brand guideline grey' });
    expect(res.status).toBe(201);
    const vs = (await admin.json(await admin.get('/api/brand/scope/company/versions'))).versions as any[];
    expect(vs[0].accessibilityAcknowledged).toBe(true);
  });
});

describe('input hardening', () => {
  let app: App, admin: Client;
  beforeAll(async () => { ({ app } = freshApp()); admin = await login(app, 'admin@aurora.example'); });
  const put = async (config: unknown) => {
    const s = await admin.json(await admin.get('/api/brand/scope/company'));
    return admin.send('PUT', '/api/brand/scope/company/draft', { config, baseRevision: s.draft.revision });
  };
  it('rejects CSS injection, unknown keys and unapproved fonts', async () => {
    for (const bad of [
      { colors: { light: { primary: 'red;} body{display:none' } } },
      { typography: { bodyFont: 'Comic Sans; } x{' } },
      { identity: { companyName: '<img src=x onerror=alert(1)>' } },
      { surprise: true },
    ]) expect((await put(bad)).status).toBe(400);
  });
  it('rejects non-object JSON bodies', async () => {
    expect((await admin.send('PUT', '/api/brand/scope/company/draft', '[1,2]', { 'content-type': 'application/json' })).status).toBe(400);
  });
  it('upload: accepts real images, rejects disguised or dangerous files, serves them safely', async () => {
    const up = (kind: string, body: Uint8Array | string) => admin.send('POST', `/api/brand/assets?kind=${kind}`, body, { 'content-type': 'application/octet-stream' });
    const ok = await up('logo', PNG);
    expect(ok.status).toBe(201);
    const { id, mime } = await ok.json();
    expect(mime).toBe('image/png');

    const served = await app.request(`/api/assets/${id}`); // public by design
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toContain('sandbox');

    expect((await up('logo', '<html><script>alert(1)</script></html>')).status).toBe(415);
    expect((await up('logo', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).status).toBe(422);
    expect((await up('logo', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>')).status).toBe(422);
    expect((await up('logo', '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.example/x.png"/></svg>')).status).toBe(422);
    expect((await up('logo', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')).status).toBe(201);
    expect((await up('nope', PNG)).status).toBe(400);
    expect((await up('logo', new Uint8Array(0))).status).toBe(400);
    expect((await up('logo', new Uint8Array(600 * 1024).fill(1))).status).toBe(413);
    expect((await up('logo', Uint8Array.from([0, 0, 1, 0, 1, 0]))).status).toBe(415); // ICO is favicon-only
    expect((await up('favicon', Uint8Array.from([0, 0, 1, 0, 1, 0]))).status).toBe(201);
  });
  it('property admins can upload only when the company lets them change identity', async () => {
    const { app: a2, db } = freshApp();
    const pa = await login(a2, 'paris.admin@maison-verde.example');
    expect((await pa.send('POST', '/api/brand/assets?kind=logo', PNG, { 'content-type': 'application/octet-stream' })).status).toBe(201); // identity allowed by default
    const co = await login(a2, 'admin@maison-verde.example');
    await co.send('PUT', '/api/brand/policy', { policy: { identity: false } });
    expect((await pa.send('POST', '/api/brand/assets?kind=logo', PNG, { 'content-type': 'application/octet-stream' })).status).toBe(403);
    void db;
  });
});

describe('theme changes never affect business data', () => {
  it('business tables and API outputs are byte-identical before and after publishing, restoring and discarding themes', async () => {
    const { app, db } = freshApp();
    const BUSINESS = ['companies', 'properties', 'departments', 'users', 'leave_requests', 'roster_shifts', 'notifications'];
    const fingerprint = () => createHash('sha256').update(BUSINESS.map((t) => JSON.stringify(all(db, `SELECT * FROM ${t} ORDER BY 1`))).join('|')).digest('hex');

    const admin = await login(app, 'admin@aurora.example');
    const mgr = await login(app, get<{ email: string }>(db, "SELECT email FROM users WHERE role='manager' AND email LIKE '%@aurora.example' LIMIT 1")!.email);
    const snapshot = async () => JSON.stringify([
      await (await mgr.get('/api/leave')).json(), await (await mgr.get('/api/roster')).json(),
      await (await mgr.get('/api/dashboard')).json(), await (await admin.get('/api/employees')).json(),
    ]);
    const dbBefore = fingerprint(), apiBefore = await snapshot();

    const sc = async () => admin.json(await admin.get('/api/brand/scope/company'));
    for (const config of [
      { colors: { light: { primary: '#aa0000' } }, shape: { radius: 'pill', density: 'spacious' }, typography: { headingFont: 'lora' } },
      { mode: { default: 'dark' }, identity: { companyName: 'Totally Different Name' } },
    ]) {
      const s = await sc();
      await admin.send('PUT', '/api/brand/scope/company/draft', { config: { ...s.draft.config, ...config }, baseRevision: s.draft.revision });
      const s2 = await sc();
      const pub = await admin.send('POST', '/api/brand/scope/company/publish', { baseRevision: s2.draft.revision, acknowledgeAccessibility: true });
      expect(pub.status).toBe(201);
    }
    await admin.send('POST', '/api/brand/scope/company/rollback', { version: 1 });
    const s3 = await sc();
    await admin.send('PUT', '/api/brand/scope/company/draft', { config: { shape: { radius: 'none' } }, baseRevision: s3.draft.revision });
    await admin.send('DELETE', '/api/brand/scope/company/draft');

    expect(fingerprint()).toBe(dbBefore);
    // Notifications are per-user state that the *workflow* writes, and branding does not, so the API view is unchanged too.
    expect(await snapshot()).toBe(apiBefore);
  });
});

describe('public brand endpoint', () => {
  const { app } = freshApp();
  it('serves published branding for the sign-in page, never drafts, and 404s unknown tenants', async () => {
    const res = await app.request('/api/public/brand?company=maison-verde&property=paris');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.identity.propertyName).toBe('Maison Verde Paris');
    expect(body.config.typography.headingFont).toBe('cormorant');
    expect((await app.request('/api/public/brand?company=nope')).status).toBe(404);
    expect((await app.request('/api/public/brand?company=maison-verde&property=harbour')).status).toBe(404); // another company's property slug
    expect((await app.request('/api/public/brand')).status).toBe(400);
  });
});
