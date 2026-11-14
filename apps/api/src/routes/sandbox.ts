import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AppCtx } from '../app.js';
import { HttpError } from '../auth.js';
import { SYSTEM } from '../db.js';
import { parseQr } from '../emv.js';
import { signSandbox } from '../payments/sandbox.js';

/**
 * The "bank" and "gateway" side of the sandbox. In production these are the customer's banking app and the
 * provider's hosted checkout — external systems that call OUR webhook. Nothing here moves real money, and these
 * routes are only registered when ALLOW_SANDBOX=true.
 */
export async function sandboxRoutes({ app, db, cfg }: AppCtx) {
  const load = async (ref: string) => {
    const t = await db.tx(SYSTEM, (q) => q.one(
      `select s.*, r.name as rname, c.fee_bps from sandbox_txns s
         left join restaurants r on r.id = s.restaurant_id
         left join restaurant_payment_configs c on c.restaurant_id = s.restaurant_id and c.provider = s.provider
        where s.ref = $1`, [ref]));
    if (!t) throw new HttpError(404, 'not_found', 'Unknown sandbox transaction');
    return t;
  };

  async function deliver(provider: string, t: any, status: 'paid' | 'failed' | 'cancelled', failure?: string) {
    const body = JSON.stringify({
      id: 'evt_' + randomBytes(8).toString('hex'), type: status === 'paid' ? 'payment.succeeded' : 'payment.failed', ref: t.ref,
      status, amount_cents: t.amount_cents, fee_cents: status === 'paid' ? Math.round((t.amount_cents * (t.fee_bps ?? 0)) / 10000) : 0,
      failure_code: failure, failure_message: failure ? failure.replace(/_/g, ' ') : undefined,
    });
    const res = await app.inject({ method: 'POST', url: `/api/webhooks/${provider}`, payload: body,
      headers: { 'content-type': 'application/json', ...signSandbox(body) } });
    return res.statusCode;
  }

  async function settle(ref: string, status: 'paid' | 'failed' | 'cancelled', failure?: string) {
    return db.tx(SYSTEM, async (q) => {
      const t = await q.one(`select * from sandbox_txns where ref = $1 for update`, [ref]);
      if (t.status !== 'pending') throw new HttpError(409, 'already_final', `Transaction is already ${t.status}`);
      if (t.expires_at && new Date(t.expires_at) < new Date()) throw new HttpError(410, 'expired', 'This payment request has expired');
      const fee = await q.one(`select fee_bps from restaurant_payment_configs where restaurant_id = $1 and provider = $2`, [t.restaurant_id, t.provider]);
      const feeCents = status === 'paid' ? Math.round((t.amount_cents * (fee?.fee_bps ?? 0)) / 10000) : 0;
      return q.one(`update sandbox_txns set status = $2, fee_cents = $3, paid_at = case when $2 = 'paid' then now() end where ref = $1 returning *`, [ref, status, feeCents]);
    });
  }

  app.get('/api/sandbox/txn/:ref', async (req) => {
    const t = await load((req.params as any).ref);
    const qr = t.qr_payload ? parseQr(t.qr_payload) : null;
    return {
      ref: t.ref, provider: t.provider, status: t.status, amountCents: t.amount_cents, merchant: t.rname, expiresAt: t.expires_at,
      qr: qr && { crcOk: qr.crcOk, merchantName: qr.fields['59'], city: qr.fields['60'], amount: qr.fields['54'], currency: qr.fields['53'],
        billNumber: qr.sub['62']?.['01'], terminal: qr.sub['62']?.['07'], network: qr.sub['26']?.['00'] },
    };
  });

  // Customer "authorises" in their (simulated) banking app.
  app.post('/api/sandbox/lankaqr/:ref/authorise', async (req) => {
    const ref = (req.params as any).ref;
    const b = z.object({ outcome: z.enum(['success', 'insufficient_funds', 'declined']).default('success'), dropWebhook: z.boolean().default(false) }).parse(req.body ?? {});
    const t0 = await load(ref);
    if (t0.provider !== 'sandbox_lankaqr') throw new HttpError(400, 'wrong_provider');
    const t = await settle(ref, b.outcome === 'success' ? 'paid' : 'failed', b.outcome === 'success' ? undefined : b.outcome);
    // dropWebhook demonstrates recovery via server-side status enquiry / reconciliation.
    const webhook = b.dropWebhook ? 'dropped' : await deliver(t.provider, { ...t, fee_bps: t0.fee_bps }, b.outcome === 'success' ? 'paid' : 'failed', b.outcome === 'success' ? undefined : b.outcome);
    return { status: t.status, webhook };
  });

  // Hosted card page (simulated). Preset TEST cards only — no free-text card entry exists anywhere.
  const CARDS: Record<string, { last4: string; label: string; flow: 'ok' | '3ds' | 'declined' | 'insufficient' }> = {
    visa_ok: { last4: '4242', label: 'Visa •••• 4242 (approves)', flow: 'ok' },
    mc_ok: { last4: '4444', label: 'Mastercard •••• 4444 (approves)', flow: 'ok' },
    visa_3ds: { last4: '3155', label: 'Visa •••• 3155 (3-D Secure challenge)', flow: '3ds' },
    declined: { last4: '0002', label: 'Visa •••• 0002 (declined)', flow: 'declined' },
    insufficient: { last4: '9995', label: 'Visa •••• 9995 (insufficient funds)', flow: 'insufficient' },
  };
  app.get('/api/sandbox/cards', async () => Object.entries(CARDS).map(([id, c]) => ({ id, label: c.label, flow: c.flow })));

  app.post('/api/sandbox/card/:ref/complete', async (req) => {
    const ref = (req.params as any).ref;
    const b = z.object({ card: z.enum(['visa_ok', 'mc_ok', 'visa_3ds', 'declined', 'insufficient', 'cancel']),
      threeDs: z.enum(['pass', 'fail']).optional(), dropWebhook: z.boolean().default(false) }).parse(req.body ?? {});
    const t0 = await load(ref);
    if (t0.provider !== 'sandbox_card') throw new HttpError(400, 'wrong_provider');
    if (t0.status !== 'pending') throw new HttpError(409, 'already_final', `Transaction is already ${t0.status}`);
    if (t0.expires_at && new Date(t0.expires_at) < new Date()) throw new HttpError(410, 'expired', 'This checkout has expired');
    const send = async (status: 'paid' | 'failed' | 'cancelled', code?: string) => {
      const t = await settle(ref, status, code);
      const webhook = b.dropWebhook ? 'dropped' : await deliver(t.provider, { ...t, fee_bps: t0.fee_bps }, status, code);
      return { status: t.status, webhook, failureCode: code };
    };
    if (b.card === 'cancel') return send('cancelled');
    const c = CARDS[b.card];
    if (c.flow === '3ds' && !b.threeDs) {
      await db.tx(SYSTEM, (q) => q.query(`update sandbox_txns set card_last4 = $2 where ref = $1`, [ref, c.last4]));
      return { status: 'pending', needs3ds: true };
    }
    if (c.flow === '3ds' && b.threeDs === 'fail') return send('failed', '3ds_authentication_failed');
    if (c.flow === 'declined') return send('failed', 'card_declined');
    if (c.flow === 'insufficient') return send('failed', 'insufficient_funds');
    await db.tx(SYSTEM, (q) => q.query(`update sandbox_txns set card_last4 = $2 where ref = $1`, [ref, c.last4]));
    return send('paid');
  });
  void cfg;
}
