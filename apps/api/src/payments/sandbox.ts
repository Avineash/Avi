import { randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { SYSTEM } from '../db.js';
import type { Config } from '../config.js';
import { buildDynamicQr } from '../emv.js';
import { hmacHex, safeEqual } from '../crypto.js';
import {
  WebhookRejected, ProviderError,
  type PaymentProvider, type ProviderCtx, type ProviderStatus, type ChargeRequest, type ProviderTxn,
} from './types.js';

/**
 * SANDBOX PROVIDERS — simulated bank/gateway. No money ever moves.
 * They behave like real providers (dynamic QR, hosted checkout, signed webhooks, status enquiry,
 * refunds, settlement files) so the whole platform is exercised end-to-end, and are blocked
 * from live mode at the service layer.
 */
export const SANDBOX_WEBHOOK_SECRET = 'sandbox-webhook-secret-not-a-real-credential';
export const SANDBOX_QR_GUID = 'LK.TABLEFLOW.SANDBOX';       // deliberately NOT a real LankaQR network GUID

export function signSandbox(body: string, ts = Math.floor(Date.now() / 1000)) {
  return { 'x-sandbox-signature': `t=${ts},v1=${hmacHex(SANDBOX_WEBHOOK_SECRET, `${ts}.${body}`)}` };
}

function verifySandbox(headers: Record<string, any>, raw: string) {
  const h = String(headers['x-sandbox-signature'] ?? '');
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h);
  if (!m) throw new WebhookRejected('missing or malformed signature');
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) throw new WebhookRejected('timestamp outside tolerance');
  if (!safeEqual(hmacHex(SANDBOX_WEBHOOK_SECRET, `${m[1]}.${raw}`), m[2])) throw new WebhookRejected('bad signature');
}

const stateOf = (t: any): ProviderStatus => {
  if (t.status === 'paid') return { state: 'paid', amountCents: t.amount_cents, feeCents: t.fee_cents };
  if (t.status === 'pending' && t.expires_at && new Date(t.expires_at) < new Date()) return { state: 'expired' };
  if (t.status === 'pending' && t.provider === 'sandbox_card' && t.card_last4) return { state: 'requires_action' };
  if (t.status === 'failed') return { state: 'failed', failureCode: t.failure_code ?? 'declined', failureMessage: 'Payment was declined' };
  if (t.status === 'cancelled') return { state: 'cancelled' };
  return { state: t.provider === 'sandbox_card' ? 'requires_action' : 'pending' };
};

abstract class SandboxBase {
  sandbox = true;
  constructor(protected db: Db, protected cfg: Config) {}
  protected async outage(): Promise<boolean> {
    const r = await this.db.tx(SYSTEM, (q) => q.one(`select value from platform_settings where key = $1`, [`sandbox.outage.${this.key}`]));
    return !!r?.value?.on;
  }
  abstract key: string;
  async getCharge(_c: ProviderCtx, ref: string): Promise<ProviderStatus> {
    const t = await this.db.tx(SYSTEM, (q) => q.one(`select * from sandbox_txns where ref = $1`, [ref]));
    if (!t) throw new ProviderError('unknown transaction');
    return stateOf(t);
  }
  peekRef(_h: Record<string, any>, raw: string) { try { return JSON.parse(raw).ref ?? null; } catch { return null; } }
  verifyWebhook(_c: ProviderCtx, headers: Record<string, any>, raw: string) {
    verifySandbox(headers, raw);
    const b = JSON.parse(raw);
    const status: ProviderStatus = b.status === 'paid'
      ? { state: 'paid', amountCents: b.amount_cents, feeCents: b.fee_cents }
      : { state: b.status, failureCode: b.failure_code, failureMessage: b.failure_message };
    return { eventId: b.id, providerRef: b.ref, type: b.type, status };
  }
  async refund(_c: ProviderCtx, ref: string, amount: number) {
    return this.db.tx(SYSTEM, async (q) => {
      const t = await q.one(`select * from sandbox_txns where ref = $1 for update`, [ref]);
      if (!t || t.status !== 'paid') return { ok: false, error: 'transaction not refundable' };
      if (t.refunded_cents + amount > t.amount_cents) return { ok: false, error: 'refund exceeds captured amount' };
      await q.query(`update sandbox_txns set refunded_cents = refunded_cents + $2 where ref = $1`, [ref, amount]);
      return { ok: true, providerRef: 'RF-' + ref };
    });
  }
  async listTransactions(_c: ProviderCtx, from: Date, to: Date): Promise<ProviderTxn[]> {
    const rows = await this.db.tx(SYSTEM, (q) => q.query(
      `select * from sandbox_txns where provider = $1 and created_at >= $2 and created_at < $3`, [this.key, from, to]));
    return rows.map((t: any) => ({ providerRef: t.ref, amountCents: t.amount_cents, state: stateOf(t).state,
      refundedCents: t.refunded_cents, feeCents: t.fee_cents, settledAt: t.settled_at, settlementRef: t.settlement_ref }));
  }
}

export class SandboxLankaQr extends SandboxBase implements PaymentProvider {
  key = 'sandbox_lankaqr'; method = 'lankaqr' as const; label = 'LankaQR (sandbox)';
  capabilities = { dynamicQr: true, deepLink: true, statusEnquiry: true, refunds: true, partialRefunds: true,
    transactionListing: true, marketplaceSplit: false };
  async checkAvailability() {
    return (await this.outage()) ? { available: false, reason: 'provider_outage' } : { available: true };
  }
  async createCharge(ctx: ProviderCtx, req: ChargeRequest) {
    if (await this.outage()) throw new ProviderError('sandbox LankaQR outage');
    const ref = 'SBQ' + randomBytes(6).toString('hex').toUpperCase();
    const qrPayload = buildDynamicQr({
      merchantAccount: { tag: '26', guid: SANDBOX_QR_GUID, merchantId: ctx.config.merchantId ?? 'SANDBOX-MERCHANT' },
      mcc: ctx.config.mcc ?? '5812', merchantName: ctx.restaurant.name, merchantCity: ctx.restaurant.city,
      amountCents: req.amountCents, billNumber: ref, terminalLabel: req.tableLabel,
    });
    await this.db.tx(SYSTEM, (q) => q.query(
      `insert into sandbox_txns (ref, provider, restaurant_id, merchant_ref, amount_cents, qr_payload, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [ref, this.key, ctx.restaurant.id, req.paymentId, req.amountCents, qrPayload, req.expiresAt]));
    return { providerRef: ref, qrPayload, deepLink: `${this.cfg.publicUrl}/sandbox/bank?ref=${ref}` };
  }
}

export class SandboxCard extends SandboxBase implements PaymentProvider {
  key = 'sandbox_card'; method = 'card' as const; label = 'Card checkout (sandbox)';
  capabilities = { dynamicQr: false, deepLink: false, statusEnquiry: true, refunds: true, partialRefunds: true,
    transactionListing: true, marketplaceSplit: false };
  async checkAvailability() { return (await this.outage()) ? { available: false, reason: 'provider_outage' } : { available: true }; }
  async createCharge(ctx: ProviderCtx, req: ChargeRequest) {
    if (await this.outage()) throw new ProviderError('sandbox card outage');
    const ref = 'SBC' + randomBytes(6).toString('hex').toUpperCase();
    await this.db.tx(SYSTEM, (q) => q.query(
      `insert into sandbox_txns (ref, provider, restaurant_id, merchant_ref, amount_cents, expires_at)
       values ($1,$2,$3,$4,$5,$6)`, [ref, this.key, ctx.restaurant.id, req.paymentId, req.amountCents, req.expiresAt]));
    // The hosted page lives on the (simulated) gateway origin — card data never touches TableFlow.
    return { providerRef: ref, redirect: { url: `${this.cfg.publicUrl}/sandbox/card/${ref}?return=${encodeURIComponent(req.returnUrl)}&cancel=${encodeURIComponent(req.cancelUrl)}`, method: 'GET' as const } };
  }
}
