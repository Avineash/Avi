import { describe, it, expect } from 'vitest';
import { crc16, buildDynamicQr, parseQr } from '../src/emv.js';
import { computeTotals } from '../src/pricing.js';
import { PayHere } from '../src/payments/payhere.js';
import { md5Upper } from '../src/crypto.js';
import { encryptSecret, decryptSecret, hashPassword, verifyPassword } from '../src/crypto.js';
import { Breaker } from '../src/payments/breaker.js';
import { csv } from '../src/routes/restaurant.js';

describe('EMV / LankaQR payload', () => {
  it('crc16 matches the CCITT-FALSE check value', () => expect(crc16('123456789')).toBe('29B1'));
  it('builds a dynamic QR that parses back and detects tampering', () => {
    const p = buildDynamicQr({ merchantAccount: { tag: '26', guid: 'LK.TABLEFLOW.SANDBOX', merchantId: 'M1' }, merchantName: 'Ceylon Brew House', merchantCity: 'Colombo', amountCents: 188210, billNumber: 'SBQ123', terminalLabel: 'T1' });
    const r = parseQr(p);
    expect(r.ok && r.crcOk).toBe(true);
    expect(r.fields['01']).toBe('12');                 // dynamic
    expect(r.fields['53']).toBe('144');                // LKR
    expect(r.fields['54']).toBe('1882.10');
    expect(r.fields['58']).toBe('LK');
    expect(r.sub['62']['01']).toBe('SBQ123');
    expect(parseQr(p.replace('1882.10', '1.10')).crcOk).toBe(false);
  });
});

describe('pricing', () => {
  it('applies service charge then tax on (subtotal + service)', () => {
    expect(computeTotals(290000, 1000, 1800)).toEqual({ subtotal: 290000, service: 29000, tax: 57420, total: 376420 });
    expect(computeTotals(100, 0, 0).total).toBe(100);
  });
});

describe('crypto', () => {
  it('round-trips secrets with AES-GCM and rejects tampering', () => {
    const k = Buffer.alloc(32, 7); const e = encryptSecret('{"a":1}', k);
    expect(decryptSecret(e, k)).toBe('{"a":1}');
    expect(() => decryptSecret(e.slice(0, -4) + 'AAAA', k)).toThrow();
  });
  it('hashes passwords', async () => { const h = await hashPassword('correct horse'); expect(await verifyPassword('correct horse', h)).toBe(true); expect(await verifyPassword('wrong', h)).toBe(false); });
  it('neutralises CSV formula injection', () => expect(csv([['=HYPERLINK("x")', 'ok']])).toBe(`"'=HYPERLINK(""x"")",ok`));
});

describe('circuit breaker', () => {
  it('opens after 3 failures and recovers after cool-down', () => {
    const b = new Breaker(3, 1000); const t = 1_000_000;
    b.failure('p', t); b.failure('p', t); expect(b.isOpen('p', t)).toBe(false);
    b.failure('p', t); expect(b.isOpen('p', t + 10)).toBe(true); expect(b.isOpen('p', t + 1001)).toBe(false);
  });
});

describe('PayHere adapter', () => {
  const ph = new PayHere();
  const ctx: any = { restaurant: { id: 'r', name: 'X', city: 'Colombo', slug: 'x' }, mode: 'sandbox', config: { merchantId: '121XXXX' }, secrets: { merchantSecret: 's3cret' }, feeBps: 0 };
  const sig = (o: Record<string, string>) => md5Upper(o.merchant_id + o.order_id + o.payhere_amount + o.payhere_currency + o.status_code + md5Upper('s3cret'));
  const body = (o: Record<string, string>, md5sig = sig(o)) => new URLSearchParams({ ...o, md5sig }).toString();
  const ok = { merchant_id: '121XXXX', order_id: 'pay-1', payment_id: '320032', payhere_amount: '1882.10', payhere_currency: 'LKR', status_code: '2' };

  it('accepts a correctly signed success notification', () => {
    const ev = ph.verifyWebhook(ctx, {}, body(ok));
    expect(ev.status).toEqual({ state: 'paid', amountCents: 188210 });
    expect(ev.providerRef).toBe('pay-1');
  });
  it('rejects a forged / tampered notification', () => {
    expect(() => ph.verifyWebhook(ctx, {}, body(ok, 'F'.repeat(32)))).toThrow();
    expect(() => ph.verifyWebhook(ctx, {}, body({ ...ok, payhere_amount: '1.00' }, sig(ok)))).toThrow();
    expect(() => ph.verifyWebhook(ctx, {}, body({ ...ok, merchant_id: 'OTHER' }))).toThrow();
  });
  it('maps cancel and failure codes', () => {
    expect(ph.verifyWebhook(ctx, {}, body({ ...ok, status_code: '-1' })).status.state).toBe('cancelled');
    expect(ph.verifyWebhook(ctx, {}, body({ ...ok, status_code: '-2' })).status.state).toBe('failed');
  });
  it('builds the hosted-checkout form with a hash and no card fields', async () => {
    const r = await ph.createCharge(ctx, { paymentId: 'pay-1', orderId: 'o', orderNumber: 7, tableLabel: 'T1', amountCents: 188210, currency: 'LKR', expiresAt: new Date(), returnUrl: 'r', cancelUrl: 'c', notifyUrl: 'n' });
    expect(r.redirect!.fields!.hash).toBe(md5Upper('121XXXX' + 'pay-1' + '1882.10' + 'LKR' + md5Upper('s3cret')));
    expect(Object.keys(r.redirect!.fields!).some((k) => /card|cvv|pan/i.test(k))).toBe(false);
    expect(r.redirect!.url).toContain('sandbox.payhere.lk');
  });
  it('reports unavailable until configured, and refuses unapproved live mode', async () => {
    expect((await ph.checkAvailability({ ...ctx, secrets: {} })).available).toBe(false);
    expect((await ph.checkAvailability({ ...ctx, mode: 'live' })).reason).toBe('live_not_approved');
  });
});
