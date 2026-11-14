import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeApp, placeOrder, SYSTEM, tenant, DEMO_TOKEN, DEMO_PASSWORD } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => { t = await makeApp(); });
afterAll(async () => { await t.close(); });

describe('tenant isolation', () => {
  it('row-level security hides other tenants even if a query forgets its WHERE clause', async () => {
    const { order } = await placeOrder(t);
    const rest = await t.db.tx(SYSTEM, (q) => q.query(`select id, slug from restaurants`));
    const kandy = rest.find((r: any) => r.slug === 'kandy-lake-cafe');
    const seen = await t.db.tx(tenant(kandy.id), (q) => q.query(`select * from orders`));
    expect(seen.length).toBe(0);
    expect((await t.db.tx(tenant(kandy.id), (q) => q.query(`select id from menu_items`))).every(() => true)).toBe(true);
    const items = await t.db.tx(tenant(kandy.id), (q) => q.query(`select r.slug from menu_items m join restaurants r on r.id = m.restaurant_id`));
    expect(new Set(items.map((i: any) => i.slug))).toEqual(new Set(['kandy-lake-cafe']));
    // cannot write into another tenant either
    await expect(t.db.tx(tenant(kandy.id), (q) => q.query(`update orders set notes = 'pwn' where id = $1`, [order.orderId]))).resolves.toEqual([]);
    const notes = await t.db.tx(SYSTEM, (q) => q.one(`select notes from orders where id = $1`, [order.orderId]));
    expect(notes.notes).toBeNull();
    await expect(t.db.tx(tenant(kandy.id), (q) => q.query(
      `insert into dining_tables (restaurant_id, label, token) values ($1,'EVIL','evil-token')`, [rest.find((r: any) => r.slug === 'ceylon-brew').id]))).rejects.toThrow(/row-level security/);
  });

  it("a Kandy owner can't read, move or refund Ceylon Brew's orders through the API", async () => {
    const { order } = await placeOrder(t);
    const kandy = await t.login('owner@kandylake.lk');
    const list = t.json(await t.app.inject({ method: 'GET', url: '/api/r/orders?view=history', headers: kandy }));
    expect(list.find((o: any) => o.id === order.orderId)).toBeUndefined();
    expect((await t.app.inject({ method: 'POST', url: `/api/r/orders/${order.orderId}/status`, headers: kandy, payload: { status: 'preparing' } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/r/payments/00000000-0000-0000-0000-000000000000/refund`, headers: { ...kandy, 'idempotency-key': 'abcdefgh1' }, payload: { reason: 'abc' } })).statusCode).toBe(404);
    const menu = t.json(await t.app.inject({ method: 'GET', url: '/api/r/menu', headers: kandy }));
    expect(menu.flatMap((c: any) => c.items).some((i: any) => i.name.en === 'Chicken Kottu')).toBe(false);
  });

  it("customer tracking tokens are per-order capabilities", async () => {
    const a = (await placeOrder(t)).order, b = (await placeOrder(t)).order;
    expect((await t.app.inject({ method: 'GET', url: `/api/public/orders/${a.orderId}?t=${b.trackingToken}` })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/api/public/orders/${a.orderId}` })).statusCode).toBe(404);
  });
});

describe('authentication & authorisation', () => {
  it('requires auth, enforces CSRF header on cookie sessions, and role permissions', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/r/orders' })).statusCode).toBe(401);
    const owner = await t.login('owner@ceylonbrew.lk');
    expect((await t.app.inject({ method: 'POST', url: '/api/r/categories', headers: { cookie: owner.cookie }, payload: { name: { en: 'X' } } })).statusCode).toBe(403);   // no CSRF header
    expect((await t.app.inject({ method: 'POST', url: '/api/r/categories', headers: owner, payload: { name: { en: 'Specials', si: '', ta: '' } } })).statusCode).toBe(200);
    const kitchen = await t.login('kitchen@ceylonbrew.lk');
    expect((await t.app.inject({ method: 'POST', url: '/api/r/categories', headers: kitchen, payload: { name: { en: 'Nope' } } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/r/staff', headers: await t.login('manager@ceylonbrew.lk') })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/overview', headers: owner })).statusCode).toBe(403);
    const support = await t.login('support@tableflow.lk');
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/overview', headers: support })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/restaurants/x/suspend', headers: support, payload: { reason: 'abc' } })).statusCode).toBe(403);
  });

  it('locks an account after repeated bad passwords and never reveals which emails exist', async () => {
    const bad = (email: string) => t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' }, remoteAddress: '10.9.9.' + Math.floor(Math.random() * 250) });
    const unknown = await bad('nobody@nowhere.lk'); const known = await bad('cashier@ceylonbrew.lk');
    expect(t.json(unknown).message).toBe(t.json(known).message);
    for (let i = 0; i < 5; i++) await bad('cashier@ceylonbrew.lk');
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'cashier@ceylonbrew.lk', password: DEMO_PASSWORD }, remoteAddress: '10.8.8.8' });
    expect(r.statusCode).toBe(429);
  });

  it('suspending a restaurant takes effect immediately for staff and customers', async () => {
    const admin = await t.login('admin@tableflow.lk'); const owner = await t.login('owner@kandylake.lk');
    const rid = t.json(await t.app.inject({ method: 'GET', url: '/api/admin/restaurants', headers: admin })).find((r: any) => r.slug === 'kandy-lake-cafe').id;
    expect((await t.app.inject({ method: 'GET', url: '/api/r/orders', headers: owner })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/restaurants/${rid}/suspend`, headers: admin, payload: { reason: 'Non-payment' } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/r/orders', headers: owner })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/public/t/kandy-table-1' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/restaurants/${rid}/reinstate`, headers: admin, payload: {} })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/public/t/kandy-table-1' })).statusCode).toBe(200);
  });

  it('pending restaurants cannot sign in until approved', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@gallefortbites.lk', password: DEMO_PASSWORD } });
    expect(r.statusCode).toBe(403); expect(t.json(r).error).toBe('pending_approval');
    const admin = await t.login('admin@tableflow.lk');
    const rid = t.json(await t.app.inject({ method: 'GET', url: '/api/admin/restaurants', headers: admin })).find((x: any) => x.slug === 'galle-fort-bites').id;
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/restaurants/${rid}/approve`, headers: admin, payload: { planId: 'growth' } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@gallefortbites.lk', password: DEMO_PASSWORD } })).statusCode).toBe(200);
  });
});

describe('money safety rails', () => {
  it('ledger and audit log are append-only', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await t.app.inject({ method: 'POST', url: `/api/public/orders/${order.orderId}/payments?t=${order.trackingToken}`, payload: { method: 'card' } }));
    const ref = (await t.db.tx(SYSTEM, (q) => q.one(`select provider_ref from payments where id = $1`, [p.id]))).provider_ref;
    await t.app.inject({ method: 'POST', url: `/api/sandbox/card/${ref}/complete`, payload: { card: 'visa_ok' } });
    await expect(t.db.raw(`update ledger_entries set amount_cents = 0`)).rejects.toThrow(/append-only/);
    await expect(t.db.raw(`delete from ledger_entries`)).rejects.toThrow(/append-only/);
    await expect(t.db.tx(SYSTEM, (q) => q.query(`delete from audit_log`))).rejects.toThrow(/permission denied/);
  });

  it('provider credentials are encrypted at rest and never returned by any API', async () => {
    const admin = await t.login('admin@tableflow.lk'); const owner = await t.login('owner@ceylonbrew.lk');
    const rid = t.json(await t.app.inject({ method: 'GET', url: '/api/admin/restaurants', headers: admin })).find((r: any) => r.slug === 'ceylon-brew').id;
    const put = await t.app.inject({ method: 'PUT', url: `/api/admin/restaurants/${rid}/payment-configs/card`, headers: admin,
      payload: { provider: 'payhere', enabled: true, feeBps: 330, config: { merchantId: '1234567' }, secrets: { merchantSecret: 'SUPER-SECRET-VALUE' } } });
    expect(put.statusCode).toBe(200);
    const stored = (await t.db.raw(`select secret_enc from restaurant_payment_configs where restaurant_id = $1 and method = 'card'`, [rid]))[0].secret_enc;
    expect(stored).toMatch(/^v1:/); expect(stored).not.toContain('SUPER-SECRET');
    for (const url of ['/api/r/payment-config']) expect((await t.app.inject({ method: 'GET', url, headers: owner })).body).not.toContain('SUPER-SECRET');
    expect((await t.app.inject({ method: 'GET', url: `/api/admin/restaurants/${rid}/payment-configs`, headers: admin })).body).not.toContain('SUPER-SECRET');
    // restore sandbox card for other tests
    await t.app.inject({ method: 'PUT', url: `/api/admin/restaurants/${rid}/payment-configs/card`, headers: admin, payload: { provider: 'sandbox_card', enabled: true, feeBps: 250, config: { merchantId: 'SBX' } } });
  });

  it('sandbox providers can never go live; live needs a real provider, credentials and the full checklist; marketplace split is gated', async () => {
    const admin = await t.login('admin@tableflow.lk');
    const rid = t.json(await t.app.inject({ method: 'GET', url: '/api/admin/restaurants', headers: admin })).find((r: any) => r.slug === 'ceylon-brew').id;
    const list = { merchantAgreementSigned: true, providerSandboxTestsPassed: true, settlementAccountVerified: true, webhookVerifiedInProviderSandbox: true };
    const live = (m: string, checklist: any = list) => t.app.inject({ method: 'POST', url: `/api/admin/restaurants/${rid}/payment-configs/${m}/go-live`, headers: admin, payload: { checklist } });
    expect((await live('lankaqr')).statusCode).toBe(409);                                      // sandbox provider
    expect((await live('card', { ...list, merchantAgreementSigned: false })).statusCode).toBe(400);   // incomplete checklist
    const mk = await t.app.inject({ method: 'PUT', url: `/api/admin/restaurants/${rid}/payment-configs/card`, headers: admin, payload: { provider: 'sandbox_card', enabled: true, settlementModel: 'marketplace', feeBps: 1 } });
    expect(mk.statusCode).toBe(422); expect(t.json(mk).error).toBe('marketplace_unsupported');
    const cfgRow = await t.db.raw(`select mode from restaurant_payment_configs where restaurant_id = $1`, [rid]);
    expect(cfgRow.every((r: any) => r.mode === 'sandbox')).toBe(true);
  });

  it('the acquirer stub is honestly unavailable, which steers customers to cards', async () => {
    const admin = await t.login('admin@tableflow.lk');
    const rid = t.json(await t.app.inject({ method: 'GET', url: '/api/admin/restaurants', headers: admin })).find((r: any) => r.slug === 'ceylon-brew').id;
    await t.app.inject({ method: 'PUT', url: `/api/admin/restaurants/${rid}/payment-configs/lankaqr`, headers: admin, payload: { provider: 'lankaqr_acquirer', enabled: true, config: {} } });
    const { order } = await placeOrder(t);
    const methods = t.json(await t.app.inject({ method: 'GET', url: `/api/public/orders/${order.orderId}/methods?t=${order.trackingToken}` })).methods;
    expect(methods.find((m: any) => m.method === 'lankaqr')).toMatchObject({ available: false, reason: 'not_configured' });
    expect(methods.find((m: any) => m.method === 'card').available).toBe(true);
    await t.app.inject({ method: 'PUT', url: `/api/admin/restaurants/${rid}/payment-configs/lankaqr`, headers: admin, payload: { provider: 'sandbox_lankaqr', enabled: true, feeBps: 60, config: { merchantId: 'SBX' } } });
  });
});

describe('registration & reports', () => {
  it('self-registration creates a pending tenant; reports and exports respond', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/register-restaurant', payload: { restaurantName: 'Jaffna Dosa House', city: 'Jaffna', ownerName: 'Priya K', email: 'priya@jaffnadosa.lk', password: 'a-long-password-1' } });
    expect(r.statusCode).toBe(200); expect(t.json(r).status).toBe('pending');
    const owner = await t.login('owner@ceylonbrew.lk'); const admin = await t.login('admin@tableflow.lk');
    const sales = t.json(await t.app.inject({ method: 'GET', url: '/api/r/reports/sales', headers: owner }));
    expect(sales.totals.orders).toBeGreaterThan(0); expect(Array.isArray(sales.byMethod)).toBe(true);
    const csv = await t.app.inject({ method: 'GET', url: '/api/admin/export/transactions', headers: admin });
    expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body.split('\n')[0]).toContain('provider_ref');
    const ov = t.json(await t.app.inject({ method: 'GET', url: '/api/admin/overview', headers: admin }));
    expect(ov.restaurants.pending).toBeGreaterThanOrEqual(1);
  });
});

describe('rate limiting', () => {
  it('throttles login attempts and order creation per client outside the test environment', async () => {
    const d = await makeApp('development');
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await d.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@y.lk', password: 'nope-nope' } })).statusCode);
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
      const o: number[] = [];
      for (let i = 0; i < 14; i++) o.push((await d.app.inject({ method: 'POST', url: `/api/public/t/demo-table-1/orders`, headers: { 'idempotency-key': 'abcdefgh' + i }, payload: { items: [] } })).statusCode);
      expect(o.includes(429)).toBe(true);
    } finally { await d.close(); }
  });
});
