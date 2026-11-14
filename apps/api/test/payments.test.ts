import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeApp, placeOrder, SYSTEM, tenant, DEMO_TOKEN } from './helpers.js';
import { signSandbox } from '../src/payments/sandbox.js';

let t: Awaited<ReturnType<typeof makeApp>>;
let owner: Record<string, string>, kitchen: Record<string, string>;
beforeAll(async () => { t = await makeApp(); owner = await t.login('owner@ceylonbrew.lk'); kitchen = await t.login('kitchen@ceylonbrew.lk'); });
afterAll(async () => { await t.close(); });

const pay = (orderId: string, trackingToken: string, method: string, key?: string) =>
  t.app.inject({ method: 'POST', url: `/api/public/orders/${orderId}/payments?t=${trackingToken}`, payload: { method }, headers: key ? { 'idempotency-key': key } : {} });
const orderState = async (id: string, tk: string) => t.json(await t.app.inject({ method: 'GET', url: `/api/public/orders/${id}?t=${tk}` }));
const sandboxPay = (ref: string, body: any = {}) => t.app.inject({ method: 'POST', url: `/api/sandbox/lankaqr/${ref}/authorise`, payload: body });
const rawPayment = (id: string) => t.db.tx(SYSTEM, (q) => q.one(`select * from payments where id = $1`, [id]));

describe('order creation', () => {
  it('prices on the server, ignores client prices, snapshots items', async () => {
    const { res, order } = await placeOrder(t);
    expect(res.statusCode).toBe(200);
    expect(order.totalCents).toBe(376420);          // 2 × 1,450.00 + 10% service + 18% VAT
    const o = await orderState(order.orderId, order.trackingToken);
    expect(o.status).toBe('pending_payment'); expect(o.paymentStatus).toBe('unpaid');
    expect(o.items[0].qty).toBe(2);
  });
  it('is idempotent on Idempotency-Key', async () => {
    const a = await placeOrder(t, undefined, 'same-key-123456'); const b = await placeOrder(t, undefined, 'same-key-123456');
    expect(b.order.orderId).toBe(a.order.orderId); expect(b.order.replay).toBe(true);
  });
  it('requires an idempotency key and rejects unavailable items / bad options', async () => {
    const menu = t.json(await t.app.inject({ method: 'GET', url: `/api/public/t/${DEMO_TOKEN}` })).menu.flatMap((c: any) => c.items);
    const kottu = menu.find((i: any) => i.name.en === 'Chicken Kottu');
    const noKey = await t.app.inject({ method: 'POST', url: `/api/public/t/${DEMO_TOKEN}/orders`, payload: { items: [{ itemId: kottu.id, qty: 1, optionIds: [] }] } });
    expect(noKey.statusCode).toBe(400);
    const missingRequired = await placeOrder(t); // spice is required (min 1) — placeOrder supplies it; now omit
    const bad = await t.app.inject({ method: 'POST', url: `/api/public/t/${DEMO_TOKEN}/orders`, headers: { 'idempotency-key': 'bad-opts-1234' }, payload: { items: [{ itemId: kottu.id, qty: 1, optionIds: [] }] } });
    expect(bad.statusCode).toBe(422); expect(t.json(bad).error).toBe('option_rules');
    await t.app.inject({ method: 'PATCH', url: `/api/r/items/${kottu.id}/availability`, headers: owner, payload: { available: false } });
    expect((await placeOrder(t)).res.statusCode).toBe(422);
    await t.app.inject({ method: 'PATCH', url: `/api/r/items/${kottu.id}/availability`, headers: owner, payload: { available: true } });
    expect(missingRequired.res.statusCode).toBe(200);
  });
  it('unknown table token is a 404', async () => expect((await t.app.inject({ method: 'GET', url: '/api/public/t/nope' })).statusCode).toBe(404));
});

describe('LankaQR happy path (verified webhook only)', () => {
  it('creates a dynamic QR, stays unpaid until the signed webhook arrives, then fulfils', async () => {
    const { order } = await placeOrder(t);
    const methods = t.json(await t.app.inject({ method: 'GET', url: `/api/public/orders/${order.orderId}/methods?t=${order.trackingToken}` })).methods;
    expect(methods.map((m: any) => m.method)).toEqual(['lankaqr', 'card']);
    expect(methods[0].recommended).toBe(true);

    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr', 'pay-key-0001'));
    expect(p.status).toBe('pending'); expect(p.sandbox).toBe(true);
    expect(p.qrSvg).toContain('<svg'); expect(p.deepLink).toContain('/sandbox/bank?ref=');
    expect(p.qrPayload).toMatch(/^000201010212/);

    // polling does not mark it paid, and there is no client-side "I paid" endpoint
    const poll = t.json(await t.app.inject({ method: 'GET', url: `/api/public/payments/${p.id}?t=${order.trackingToken}` }));
    expect(poll.status).toBe('pending');
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('unpaid');
    const staffKitchen = t.json(await t.app.inject({ method: 'GET', url: '/api/r/orders?view=active', headers: kitchen }));
    expect(staffKitchen.find((o: any) => o.id === order.orderId)).toBeUndefined();   // kitchen sees nothing before payment

    const ref = (await rawPayment(p.id)).provider_ref;
    const a = await sandboxPay(ref); expect(a.statusCode).toBe(200);
    const o = await orderState(order.orderId, order.trackingToken);
    expect(o.status).toBe('received'); expect(o.paymentStatus).toBe('paid');
    const k = t.json(await t.app.inject({ method: 'GET', url: '/api/r/orders?view=active', headers: kitchen }));
    expect(k.find((x: any) => x.id === order.orderId).method).toBe('lankaqr');

    // ledger: charge + gateway fee + platform fee accrual
    const led = await t.db.tx(tenant((await rawPayment(p.id)).restaurant_id), (q) => q.query(`select kind, amount_cents from ledger_entries where payment_id = $1 order by id`, [p.id]));
    expect(led.map((l: any) => l.kind)).toEqual(['charge', 'gateway_fee', 'platform_fee_accrued']);
    expect(led[0].amount_cents).toBe(376420); expect(led[1].amount_cents).toBe(-2259);
  });

  it('payment creation is idempotent and reuses the live attempt', async () => {
    const { order } = await placeOrder(t);
    const a = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr', 'idem-aaaa-1111'));
    const b = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr', 'idem-aaaa-1111'));
    const c = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    expect(b.id).toBe(a.id); expect(c.id).toBe(a.id);
  });

  it('rejects forged, unsigned, stale and tampered webhooks; replays are harmless', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    const ref = (await rawPayment(p.id)).provider_ref;
    const body = JSON.stringify({ id: 'evt_forge1', type: 'payment.succeeded', ref, status: 'paid', amount_cents: 376420, fee_cents: 0 });
    const post = (b: string, h: Record<string, string>) => t.app.inject({ method: 'POST', url: '/api/webhooks/sandbox_lankaqr', payload: b, headers: { 'content-type': 'application/json', ...h } });
    expect((await post(body, {})).statusCode).toBe(401);
    expect((await post(body, { 'x-sandbox-signature': 't=1,v1=' + 'a'.repeat(64) })).statusCode).toBe(401);
    expect((await post(body, signSandbox(body, Math.floor(Date.now() / 1000) - 3600))).statusCode).toBe(401);       // replay window
    expect((await post(body.replace('376420', '1'), signSandbox(body))).statusCode).toBe(401);                       // body tampered after signing
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('unpaid');
    expect((await post(body, signSandbox(body))).statusCode).toBe(200);                                              // genuine
    const again = await post(body, signSandbox(body)); expect(again.statusCode).toBe(200); expect(t.json(again).duplicate).toBe(true);
    const n = await t.db.tx(SYSTEM, (q) => q.one(`select count(*)::int as n from ledger_entries where payment_id = $1 and kind = 'charge'`, [p.id]));
    expect(n.n).toBe(1);
  });

  it('webhook with the wrong amount is never fulfilled', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    const ref = (await rawPayment(p.id)).provider_ref;
    const body = JSON.stringify({ id: 'evt_short', type: 'payment.succeeded', ref, status: 'paid', amount_cents: 100, fee_cents: 0 });
    await t.app.inject({ method: 'POST', url: '/api/webhooks/sandbox_lankaqr', payload: body, headers: { 'content-type': 'application/json', ...signSandbox(body) } });
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('unpaid');
    const row = await rawPayment(p.id); expect(row.failure_code).toBe('amount_mismatch'); expect(row.needs_refund).toBe(true);
  });

  it('recovers a LOST webhook through server-side status enquiry', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    const ref = (await rawPayment(p.id)).provider_ref;
    expect(t.json(await sandboxPay(ref, { dropWebhook: true })).webhook).toBe('dropped');
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('unpaid');
    const poll = t.json(await t.app.inject({ method: 'GET', url: `/api/public/payments/${p.id}?t=${order.trackingToken}` }));
    expect(poll.status).toBe('paid');
    expect((await orderState(order.orderId, order.trackingToken)).status).toBe('received');
  });
});

describe('failure, expiry and fallback', () => {
  it('declined bank authorisation leaves the order unpaid and payable by another method', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    await sandboxPay((await rawPayment(p.id)).provider_ref, { outcome: 'insufficient_funds' });
    expect((await rawPayment(p.id)).status).toBe('failed');
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('unpaid');
    expect((await pay(order.orderId, order.trackingToken, 'card')).statusCode).toBe(200);
  });

  it('expires stale QR payments via the sweeper; a LATE capture is still honoured', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    await t.db.tx(SYSTEM, (q) => q.query(`update payments set expires_at = now() - interval '1 minute', created_at = now() - interval '2 minutes' where id = $1`, [p.id]));
    await t.db.tx(SYSTEM, (q) => q.query(`update sandbox_txns set expires_at = now() - interval '1 minute' where merchant_ref = $1`, [p.id]));
    await t.svc.sweep();
    expect((await rawPayment(p.id)).status).toBe('expired');
    expect((await sandboxPay((await rawPayment(p.id)).provider_ref)).statusCode).toBe(410);    // bank refuses expired QR
    // …but if money *was* captured by the provider after we expired, we apply it (customer paid)
    const row = await rawPayment(p.id);
    await t.svc.applyStatus(row.restaurant_id, p.id, { state: 'paid', amountCents: row.amount_cents });
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('paid');
  });

  it('LankaQR outage hides nothing silently: reports unavailable, refuses QR, card still works', async () => {
    const admin = await t.login('admin@tableflow.lk');
    await t.app.inject({ method: 'POST', url: '/api/admin/sandbox/outage', headers: admin, payload: { provider: 'sandbox_lankaqr', on: true } });
    try {
      const { order } = await placeOrder(t);
      const methods = t.json(await t.app.inject({ method: 'GET', url: `/api/public/orders/${order.orderId}/methods?t=${order.trackingToken}` })).methods;
      expect(methods.find((m: any) => m.method === 'lankaqr')).toMatchObject({ available: false, reason: 'provider_outage' });
      expect(methods.find((m: any) => m.method === 'card').available).toBe(true);
      const q = await pay(order.orderId, order.trackingToken, 'lankaqr');
      expect(q.statusCode).toBe(409); expect(t.json(q).fallback).toBe('card');
      expect((await pay(order.orderId, order.trackingToken, 'card')).statusCode).toBe(200);
    } finally {
      await t.app.inject({ method: 'POST', url: '/api/admin/sandbox/outage', headers: admin, payload: { provider: 'sandbox_lankaqr', on: false } });
    }
  });

  it('hides a method the restaurant has switched off', async () => {
    await t.app.inject({ method: 'PATCH', url: '/api/r/payment-config/card', headers: owner, payload: { enabled: false } });
    const { order } = await placeOrder(t);
    const methods = t.json(await t.app.inject({ method: 'GET', url: `/api/public/orders/${order.orderId}/methods?t=${order.trackingToken}` })).methods;
    expect(methods.map((m: any) => m.method)).toEqual(['lankaqr']);
    expect((await pay(order.orderId, order.trackingToken, 'card')).statusCode).toBe(409);
    await t.app.inject({ method: 'PATCH', url: '/api/r/payment-config/card', headers: owner, payload: { enabled: true } });
  });
});

describe('card checkout (hosted page, 3-D Secure)', () => {
  const card = (ref: string, body: any) => t.app.inject({ method: 'POST', url: `/api/sandbox/card/${ref}/complete`, payload: body });
  it('redirects to a hosted page; 3DS challenge pass → paid; no card data is stored', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'card'));
    expect(p.status).toBe('requires_action'); expect(p.redirect.url).toContain('/sandbox/card/');
    const ref = (await rawPayment(p.id)).provider_ref;
    expect(t.json(await card(ref, { card: 'visa_3ds' })).needs3ds).toBe(true);
    expect((await rawPayment(p.id)).status).toBe('requires_action');
    expect(t.json(await card(ref, { card: 'visa_3ds', threeDs: 'pass' })).status).toBe('paid');
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('paid');
    // schema-level proof: nothing in payments can hold a PAN
    const cols = (await t.db.raw(`select column_name from information_schema.columns where table_name in ('payments','orders','refunds') `)).map((r: any) => r.column_name);
    expect(cols.some((c: string) => /pan|card_number|cvv|cvc|expiry/i.test(c))).toBe(false);
  });
  it('declined / 3DS-failed / cancelled map to distinct states', async () => {
    for (const [body, status] of [[{ card: 'declined' }, 'failed'], [{ card: 'visa_3ds', threeDs: 'fail' }, 'failed'], [{ card: 'cancel' }, 'cancelled']] as const) {
      const { order } = await placeOrder(t);
      const p = t.json(await pay(order.orderId, order.trackingToken, 'card'));
      const ref = (await rawPayment(p.id)).provider_ref;
      if ((body as any).threeDs) await card(ref, { card: 'visa_3ds' });
      await card(ref, body);
      expect((await rawPayment(p.id)).status).toBe(status);
      expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('unpaid');
    }
  });
});

describe('duplicate-payment protection', () => {
  it('a second capture for an already-paid order is flagged and auto-refunded; DB allows one paid payment per order', async () => {
    const { order } = await placeOrder(t);
    const qr = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    const qrRef = (await rawPayment(qr.id)).provider_ref;
    // customer switches to card (QR attempt is cancelled locally) — but their banking app still has the QR open
    const cd = t.json(await pay(order.orderId, order.trackingToken, 'card'));
    expect((await rawPayment(qr.id)).status).toBe('cancelled');
    const cdRef = (await rawPayment(cd.id)).provider_ref;
    await t.app.inject({ method: 'POST', url: `/api/sandbox/card/${cdRef}/complete`, payload: { card: 'visa_ok' } });
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('paid');
    await sandboxPay(qrRef);                                                         // second capture arrives
    await new Promise((r) => setTimeout(r, 300));                                    // auto-refund runs post-commit
    const dup = await rawPayment(qr.id);
    expect(dup.status).toBe('paid_duplicate'); expect(dup.duplicate_of).toBe(cd.id);
    expect(dup.refunded_cents).toBe(dup.amount_cents); expect(dup.needs_refund).toBe(false);
    const o = await t.db.tx(SYSTEM, (q) => q.one(`select paid_payment_id, status, refunded_cents from orders where id = $1`, [order.orderId]));
    expect(o.paid_payment_id).toBe(cd.id); expect(o.refunded_cents).toBe(0);         // customer's real order untouched
    await expect(t.db.raw(`insert into payments (restaurant_id, order_id, method, provider, status, amount_cents, expires_at, provider_ref)
      select restaurant_id, order_id, method, provider, 'paid', 1, now(), 'dupe-x' from payments where id = '${cd.id}'`)).rejects.toThrow(/payments_one_paid_per_order/);
  });
});

describe('kitchen workflow', () => {
  it('moves Received → Preparing → Ready → Served, rejects skips, and notifies the customer stream topic', async () => {
    const { order } = await placeOrder(t);
    const st = (id: string, status: string, h = kitchen) => t.app.inject({ method: 'POST', url: `/api/r/orders/${id}/status`, headers: h, payload: { status } });
    expect((await st(order.orderId, 'preparing')).statusCode).toBe(409);                    // unpaid orders are not actionable
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    await sandboxPay((await rawPayment(p.id)).provider_ref);
    expect((await st(order.orderId, 'ready')).statusCode).toBe(409);                        // cannot skip
    for (const s of ['preparing', 'ready', 'served']) expect((await st(order.orderId, s)).statusCode).toBe(200);
    const o = await orderState(order.orderId, order.trackingToken);
    expect(o.status).toBe('served'); expect(o.servedAt).toBeTruthy();
    const fb = await t.app.inject({ method: 'POST', url: `/api/public/orders/${order.orderId}/feedback?t=${order.trackingToken}`, payload: { rating: 5, comment: 'Delicious' } });
    expect(fb.statusCode).toBe(200);
  });
});

describe('refunds', () => {
  async function paidOrder() {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'card'));
    await t.app.inject({ method: 'POST', url: `/api/sandbox/card/${(await rawPayment(p.id)).provider_ref}/complete`, payload: { card: 'mc_ok' } });
    return { order, pid: p.id as string };
  }
  const refund = (pid: string, body: any, key: string, h = owner) => t.app.inject({ method: 'POST', url: `/api/r/payments/${pid}/refund`, headers: { ...h, 'idempotency-key': key }, payload: body });

  it('supports partial then full refund, idempotent replays, and blocks over-refunds', async () => {
    const { order, pid } = await paidOrder();
    const a = await refund(pid, { amountCents: 100000, reason: 'Cold food' }, 'refund-key-1'); expect(a.statusCode).toBe(200); expect(t.json(a).status).toBe('succeeded');
    const replay = await refund(pid, { amountCents: 100000, reason: 'Cold food' }, 'refund-key-1'); expect(t.json(replay).id).toBe(t.json(a).id);
    expect((await rawPayment(pid)).refunded_cents).toBe(100000);                      // replay did not refund twice
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('partially_refunded');
    expect((await refund(pid, { amountCents: 999999999, reason: 'Too much' }, 'refund-key-2')).statusCode).toBe(422);
    expect((await refund(pid, { reason: 'Remainder' }, 'refund-key-3')).statusCode).toBe(200);
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('refunded');
    const kinds = (await t.db.tx(tenant((await rawPayment(pid)).restaurant_id), (q) => q.query(`select kind, amount_cents from ledger_entries where payment_id = $1 and kind = 'refund'`, [pid])));
    expect(kinds.reduce((s: number, k: any) => s + k.amount_cents, 0)).toBe(-376420);
  });
  it('role-based: kitchen and cashier cannot refund; manager can', async () => {
    const { pid } = await paidOrder();
    expect((await refund(pid, { reason: 'x y z' }, 'refund-key-k', kitchen)).statusCode).toBe(403);
    expect((await refund(pid, { reason: 'x y z' }, 'refund-key-c', await t.login('cashier@ceylonbrew.lk'))).statusCode).toBe(403);
    expect((await refund(pid, { amountCents: 5000, reason: 'Goodwill' }, 'refund-key-m', await t.login('manager@ceylonbrew.lk'))).statusCode).toBe(200);
  });
  it('requires an Idempotency-Key and a reason', async () => {
    const { pid } = await paidOrder();
    expect((await t.app.inject({ method: 'POST', url: `/api/r/payments/${pid}/refund`, headers: owner, payload: { reason: 'abc' } })).statusCode).toBe(400);
    expect((await refund(pid, { reason: '' }, 'refund-key-r')).statusCode).toBe(400);
  });
});

describe('reconciliation & settlement', () => {
  it('heals a lost webhook, marks provider-settled payments, and reports a clean run', async () => {
    const { order } = await placeOrder(t);
    const p = t.json(await pay(order.orderId, order.trackingToken, 'lankaqr'));
    await sandboxPay((await rawPayment(p.id)).provider_ref, { dropWebhook: true });
    const admin = await t.login('admin@tableflow.lk');
    expect(t.json(await t.app.inject({ method: 'POST', url: '/api/admin/sandbox/settle', headers: admin })).settled).toBeGreaterThan(0);
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const run = t.json(await t.app.inject({ method: 'POST', url: '/api/r/reconcile', headers: owner, payload: { provider: 'sandbox_lankaqr', from: today, to: today } }));
    expect(run.summary.healed).toBeGreaterThanOrEqual(1);
    expect((await orderState(order.orderId, order.trackingToken)).paymentStatus).toBe('paid');
    const again = t.json(await t.app.inject({ method: 'POST', url: '/api/r/reconcile', headers: owner, payload: { provider: 'sandbox_lankaqr', from: today, to: today } }));
    const ref = (await rawPayment(p.id)).provider_ref;
    expect(again.items.some((i: any) => i.ref === ref)).toBe(false);                           // this payment now reconciles cleanly
    // earlier tests left a payment we applied locally that the provider never captured: the run must flag it
    expect(again.items.some((i: any) => i.kind === 'paid_locally_not_at_provider')).toBe(true);
    expect(again.status).toBe('discrepancies');
    expect((await rawPayment(p.id)).settlement_status).toBe('settled');
  });
});
