import QRCode from 'qrcode';
import type { Db, Q } from '../db.js';
import { SYSTEM, tenant } from '../db.js';
import type { Config } from '../config.js';
import { decryptSecret } from '../crypto.js';
import { HttpError } from '../auth.js';
import { audit, type Actor } from '../audit.js';
import { publish, topics } from '../events.js';
import { Breaker } from './breaker.js';
import type { Registry } from './registry.js';
import {
  ProviderUnsupported, WebhookRejected,
  type Method, type PaymentProvider, type ProviderCtx, type ProviderStatus,
} from './types.js';

export const OPEN = ['created', 'pending', 'requires_action'];
const TTL_MS: Record<Method, number> = { lankaqr: 5 * 60_000, card: 15 * 60_000 };
const PROVIDER_TIMEOUT_MS = 10_000;

const withTimeout = <T>(p: Promise<T>, ms = PROVIDER_TIMEOUT_MS): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('provider timeout')), ms))]);

export interface Outcome {
  changed: boolean; becamePaid: boolean; duplicate: boolean;
  restaurantId: string; orderId: string; paymentId: string; orderNumber?: number; status: string;
}

export class PaymentService {
  constructor(public db: Db, public cfg: Config, public registry: Registry, public breaker = new Breaker()) {}

  /* ───────────── provider context ───────────── */

  async loadCtx(q: Q, restaurantId: string, method: Method, providerKey?: string) {
    const row = await q.one(
      `select c.*, r.name as rname, r.city as rcity, r.slug as rslug from restaurant_payment_configs c
         join restaurants r on r.id = c.restaurant_id where c.restaurant_id = $1 and c.method = $2`, [restaurantId, method]);
    if (!row || (!providerKey && !row.enabled)) return null;
    const provider = this.registry.get(providerKey ?? row.provider);
    if (!provider || provider.method !== method) return null;
    if (row.mode === 'live' && provider.sandbox) return null;                 // sandbox can never be "live"
    if (row.mode === 'live' && !row.live_approved_at) return null;            // live needs explicit platform approval
    let secrets: Record<string, string> = {};
    if (row.secret_enc) secrets = JSON.parse(decryptSecret(row.secret_enc, this.cfg.secretsKey));
    const ctx: ProviderCtx = {
      restaurant: { id: restaurantId, name: row.rname, city: row.rcity ?? 'Colombo', slug: row.rslug },
      mode: provider.sandbox ? 'sandbox' : row.mode,
      config: { ...row.config, liveApproved: !!row.live_approved_at }, secrets, feeBps: row.fee_bps,
    };
    return { provider, ctx, row };
  }

  /** What the customer's checkout shows. Unconfigured methods are hidden; unavailable ones are flagged. */
  async methodsFor(restaurantId: string) {
    const rows = await this.db.tx(tenant(restaurantId), async (q) => {
      const out = [];
      for (const m of ['lankaqr', 'card'] as Method[]) out.push({ m, lc: await this.loadCtx(q, restaurantId, m) });
      return out;
    });
    const res = [];
    for (const { m, lc } of rows) {
      if (!lc) continue;                                                     // not configured/enabled => hidden
      let available = false, reason: string | undefined;
      if (this.breaker.isOpen(lc.provider.key)) reason = 'provider_outage';
      else {
        try { ({ available, reason } = await withTimeout(lc.provider.checkAvailability(lc.ctx), 5000)); }
        catch { reason = 'provider_outage'; }
      }
      res.push({ method: m, available, reason, recommended: m === 'lankaqr', sandbox: lc.provider.sandbox,
        capabilities: { deepLink: lc.provider.capabilities.deepLink } });
    }
    return res;
  }

  /* ───────────── create ───────────── */

  async createPayment(a: { restaurantId: string; orderId: string; method: Method; idempotencyKey?: string }) {
    const scope = tenant(a.restaurantId);
    // phase 0 — read-only: config + idempotent replay
    const pre = await this.db.tx(scope, async (q) => ({
      lc: await this.loadCtx(q, a.restaurantId, a.method),
      replay: await this.findReusable(q, a.orderId, a.method, a.idempotencyKey),
    }));
    if (pre.replay) return this.view(pre.replay);
    if (!pre.lc) throw new HttpError(409, 'method_unavailable', 'This payment method is not available', { fallback: a.method === 'lankaqr' ? 'card' : null });
    const { provider, ctx } = pre.lc;

    let avail = { available: true, reason: undefined as string | undefined };
    if (this.breaker.isOpen(provider.key)) avail = { available: false, reason: 'provider_outage' };
    else { try { avail = await withTimeout(provider.checkAvailability(ctx), 5000) as any; } catch { avail = { available: false, reason: 'provider_outage' }; } }
    if (!avail.available)
      throw new HttpError(409, 'method_unavailable', 'This payment method is temporarily unavailable',
        { reason: avail.reason, fallback: a.method === 'lankaqr' ? 'card' : null });

    // phase 1 — reserve the attempt (row exists before we talk to the provider)
    const prep = await this.db.tx(scope, async (q) => {
      const order = await q.one(
        `select o.*, t.label as table_label from orders o join dining_tables t on t.id = o.table_id where o.id = $1 for update of o`, [a.orderId]);
      if (!order) throw new HttpError(404, 'not_found', 'Order not found');
      if (order.payment_status !== 'unpaid' || !['pending_payment', 'expired'].includes(order.status))
        throw new HttpError(409, 'order_not_payable', 'This order is not awaiting payment');
      const again = await this.findReusable(q, a.orderId, a.method, a.idempotencyKey);
      if (again) return { again };
      await q.query(`update payments set status = 'cancelled', updated_at = now()
                      where order_id = $1 and status = any($2) and method <> $3`, [a.orderId, OPEN, a.method]);
      await q.query(`update orders set status = 'pending_payment', mode = $2 where id = $1`, [a.orderId, ctx.mode]);
      const p = await q.one(
        `insert into payments (restaurant_id, order_id, method, provider, mode, status, amount_cents, currency, idempotency_key, expires_at)
         values ($1,$2,$3,$4,$5,'created',$6,$7,$8,$9) returning *`,
        [a.restaurantId, a.orderId, a.method, provider.key, ctx.mode, order.total_cents, order.currency,
         a.idempotencyKey ?? null, new Date(Date.now() + TTL_MS[a.method])]);
      return { order, p };
    });
    if ('again' in prep && prep.again) return this.view(prep.again);
    const { order, p } = prep as { order: any; p: any };

    // phase 2 — provider call (outside any DB transaction)
    const base = this.cfg.publicUrl;
    try {
      const res = await withTimeout(provider.createCharge(ctx, {
        paymentId: p.id, orderId: order.id, orderNumber: order.number, tableLabel: order.table_label,
        amountCents: order.total_cents, currency: order.currency, expiresAt: p.expires_at,
        returnUrl: `${base}/o/${order.id}?t=${order.tracking_token}`,
        cancelUrl: `${base}/o/${order.id}?t=${order.tracking_token}&cancelled=1`,
        notifyUrl: `${base}/api/webhooks/${provider.key}`,
        customer: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone },
      }));
      this.breaker.success(provider.key);
      const status = res.redirect ? 'requires_action' : 'pending';
      const saved = await this.db.tx(scope, (q) => q.one(
        `update payments set provider_ref = $2, provider_data = $3, status = $4, updated_at = now() where id = $1 returning *`,
        [p.id, res.providerRef, JSON.stringify({ qrPayload: res.qrPayload, deepLink: res.deepLink, redirect: res.redirect }), status]));
      return this.view(saved);
    } catch (e: any) {
      this.breaker.failure(provider.key);
      await this.db.tx(scope, (q) => q.query(
        `update payments set status = 'failed', failure_code = 'provider_error', failure_message = $2, updated_at = now() where id = $1`,
        [p.id, String(e?.message ?? e).slice(0, 200)]));
      throw new HttpError(503, 'provider_error', 'The payment provider could not start this payment',
        { fallback: a.method === 'lankaqr' ? 'card' : null });
    }
  }

  private async findReusable(q: Q, orderId: string, method: Method, key?: string) {
    if (key) {
      const byKey = await q.one(`select * from payments where order_id = $1 and idempotency_key = $2`, [orderId, key]);
      if (byKey) return byKey;
    }
    return q.one(`select * from payments where order_id = $1 and method = $2 and status = any($3) and expires_at > now()
                   and provider_ref is not null order by created_at desc limit 1`, [orderId, method, OPEN]);
  }

  async view(p: any) {
    const d = p.provider_data ?? {};
    return {
      id: p.id, orderId: p.order_id, method: p.method, status: p.status, amountCents: p.amount_cents, currency: p.currency,
      expiresAt: p.expires_at, mode: p.mode, sandbox: p.mode === 'sandbox',
      qrSvg: d.qrPayload ? await QRCode.toString(d.qrPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : undefined,
      qrPayload: d.qrPayload, deepLink: d.deepLink, redirect: d.redirect,
      failureCode: p.failure_code, failureMessage: p.failure_message,
    };
  }

  /* ───────────── state machine ───────────── */

  /** Idempotent, race-safe application of a provider-reported state. Caller supplies the tenant tx. */
  async applyStatusTx(q: Q, paymentId: string, st: ProviderStatus): Promise<Outcome> {
    const p = await q.one(`select * from payments where id = $1 for update`, [paymentId]);
    if (!p) throw new HttpError(404, 'not_found');
    const out: Outcome = { changed: false, becamePaid: false, duplicate: false, restaurantId: p.restaurant_id,
      orderId: p.order_id, paymentId: p.id, status: p.status };
    if (p.status === 'paid' || p.status === 'paid_duplicate') return out;     // terminal: replays are no-ops

    if (st.state !== 'paid') {
      if (!OPEN.includes(p.status) || st.state === p.status) return out;
      const next = st.state;
      await q.query(`update payments set status = $2, failure_code = $3, failure_message = $4, updated_at = now() where id = $1`,
        [p.id, next, st.failureCode ?? null, st.failureMessage ?? null]);
      return { ...out, changed: true, status: next };
    }

    // ---- money has been captured ----
    const order = await q.one(`select * from orders where id = $1 for update`, [p.order_id]);
    out.orderNumber = order.number;
    const fee = st.feeCents ?? Math.round((p.amount_cents * (await this.feeBps(q, p))) / 10000);
    if (st.amountCents !== undefined && st.amountCents !== p.amount_cents) {
      // Captured amount differs from what we asked for: never auto-fulfil. Flag for refund + human review.
      await q.query(`update payments set status = 'failed', failure_code = 'amount_mismatch', needs_refund = true, paid_at = now(),
                      failure_message = $2, updated_at = now() where id = $1`,
        [p.id, `Provider captured ${st.amountCents}, expected ${p.amount_cents}`]);
      await this.ledger(q, p, 'adjustment', st.amountCents, { note: 'amount_mismatch' });
      return { ...out, changed: true, status: 'failed' };
    }
    const mid = order.paid_payment_id === null;
    if (mid) {
      await q.query(`update payments set status = 'paid', paid_at = now(), gateway_fee_cents = $2, updated_at = now() where id = $1`, [p.id, fee]);
      // A late payment on an expired/cancelled order is honoured: the customer's money was taken.
      await q.query(`update orders set status = 'received', payment_status = 'paid', paid_at = now(), paid_payment_id = $2 where id = $1`, [order.id, p.id]);
      await q.query(`update payments set status = 'cancelled', updated_at = now() where order_id = $1 and id <> $2 and status = any($3)`, [order.id, p.id, OPEN]);
      await this.ledger(q, p, 'charge', p.amount_cents);
      if (fee) await this.ledger(q, p, 'gateway_fee', -fee);
      await this.platformFee(q, p);
      const to = order.customer_email ? ['email', order.customer_email] : order.customer_phone ? ['sms', order.customer_phone] : null;
      if (to) await q.query(`insert into outbox (restaurant_id, order_id, channel, to_addr, template) values ($1,$2,$3,$4,'receipt')`, [p.restaurant_id, order.id, to[0], to[1]]);
      return { ...out, changed: true, becamePaid: true, status: 'paid' };
    }
    // Second capture for an already-paid order => duplicate. Keep the money trail, queue a refund.
    await q.query(`update payments set status = 'paid_duplicate', paid_at = now(), gateway_fee_cents = $2, duplicate_of = $3,
                    needs_refund = true, updated_at = now() where id = $1`, [p.id, fee, order.paid_payment_id]);
    await this.ledger(q, p, 'duplicate_charge', p.amount_cents, { duplicateOf: order.paid_payment_id });
    if (fee) await this.ledger(q, p, 'gateway_fee', -fee);
    return { ...out, changed: true, duplicate: true, status: 'paid_duplicate' };
  }

  private async feeBps(q: Q, p: any) {
    const r = await q.one(`select fee_bps from restaurant_payment_configs where restaurant_id = $1 and method = $2`, [p.restaurant_id, p.method]);
    return r?.fee_bps ?? 0;
  }
  private async ledger(q: Q, p: any, kind: string, amount: number, meta: object = {}) {
    await q.query(`insert into ledger_entries (restaurant_id, payment_id, order_id, kind, amount_cents, currency, ref, meta)
                   values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.restaurant_id, p.id, p.order_id, kind, amount, p.currency, p.provider_ref, JSON.stringify(meta)]);
  }
  /** Direct settlement (default): platform fee is accrued as a receivable and invoiced separately.
   *  Marketplace settlement: only when provider capability + config allow it; recorded as deducted. */
  private async platformFee(q: Q, p: any) {
    const r = await q.one(
      `select pl.txn_fee_bps, c.settlement_model from restaurants r join plans pl on pl.id = r.plan_id
         left join restaurant_payment_configs c on c.restaurant_id = r.id and c.method = $2 where r.id = $1`, [p.restaurant_id, p.method]);
    const fee = r ? Math.round((p.amount_cents * r.txn_fee_bps) / 10000) : 0;
    if (fee > 0) await this.ledger(q, p, r.settlement_model === 'marketplace' ? 'platform_fee_deducted' : 'platform_fee_accrued', -fee, { bps: r.txn_fee_bps });
  }

  async afterApply(o: Outcome) {
    if (!o.changed) return;
    publish(topics.order(o.orderId), { type: 'payment.updated', paymentId: o.paymentId, status: o.status });
    if (o.becamePaid) {
      publish(topics.order(o.orderId), { type: 'order.updated', status: 'received' });
      publish(topics.restaurant(o.restaurantId), { type: 'order.paid', orderId: o.orderId, number: o.orderNumber });
    }
    if (o.duplicate) {
      publish(topics.restaurant(o.restaurantId), { type: 'payment.duplicate', paymentId: o.paymentId });
      // Best-effort automatic refund of the duplicate where the provider supports it.
      this.refund({ restaurantId: o.restaurantId, paymentId: o.paymentId, reason: 'Duplicate payment (auto)', auto: true,
        idempotencyKey: `auto-dup-${o.paymentId}`, actor: { role: 'system' } }).catch(() => undefined);
    }
  }

  async applyStatus(restaurantId: string, paymentId: string, st: ProviderStatus) {
    const o = await this.db.tx(tenant(restaurantId), (q) => this.applyStatusTx(q, paymentId, st));
    await this.afterApply(o);
    return o;
  }

  /* ───────────── webhooks ───────────── */

  async handleWebhook(providerKey: string, headers: Record<string, any>, raw: string) {
    const provider = this.registry.get(providerKey);
    if (!provider) throw new HttpError(404, 'unknown_provider');
    const ref = provider.peekRef(headers, raw);
    const pay = ref ? await this.db.tx(SYSTEM, (q) => q.one(`select id, restaurant_id, method from payments where provider = $1 and provider_ref = $2`, [providerKey, ref])) : null;
    const reject = async (why: string) => {
      await this.db.tx(SYSTEM, (q) => q.query(
        `insert into payment_events (provider, event_id, payload, signature_ok, result) values ($1,$2,$3,false,$4)
         on conflict (provider, event_id) do nothing`, [providerKey, `rej-${Date.now()}-${Math.random().toString(36).slice(2)}`, JSON.stringify({ raw: raw.slice(0, 500) }), why]));
      throw new HttpError(401, 'invalid_webhook', 'Webhook could not be verified');
    };
    if (!pay) return reject('unknown_reference');
    const lc = await this.db.tx(tenant(pay.restaurant_id), (q) => this.loadCtx(q, pay.restaurant_id, pay.method, providerKey));
    if (!lc) return reject('provider_not_configured');
    let ev;
    try { ev = lc.provider.verifyWebhook(lc.ctx, headers, raw); }
    catch (e) { return reject(e instanceof WebhookRejected ? e.message : 'verification_error'); }
    if (ev.providerRef !== ref) return reject('reference_mismatch');

    const outcome = await this.db.tx(tenant(pay.restaurant_id), async (q) => {
      const ins = await q.one(
        `insert into payment_events (provider, event_id, payment_id, event_type, payload, signature_ok)
         values ($1,$2,$3,$4,$5,true) on conflict (provider, event_id) do nothing returning id`,
        [providerKey, ev.eventId, pay.id, ev.type, JSON.stringify({ state: ev.status.state, amount: ev.status.amountCents })]);
      if (!ins) return null;                                                 // duplicate delivery: already processed
      const o = await this.applyStatusTx(q, pay.id, ev.status);
      await q.query(`update payment_events set result = $2 where id = $1`, [ins.id, o.status]);
      return o;                                                              // event row + state change commit atomically
    });
    if (outcome) await this.afterApply(outcome);
    return { ok: true, duplicate: !outcome };
  }

  /* ───────────── enquiry, expiry, sweeping ───────────── */

  /** Server-side status enquiry. Used when the customer polls, and by the sweeper. */
  async refresh(restaurantId: string, paymentId: string) {
    const scope = tenant(restaurantId);
    const p = await this.db.tx(scope, (q) => q.one(`select * from payments where id = $1`, [paymentId]));
    if (!p || !OPEN.includes(p.status)) return p;
    const lc = await this.db.tx(scope, (q) => this.loadCtx(q, restaurantId, p.method, p.provider));
    let st: ProviderStatus | undefined;
    if (lc && p.provider_ref && lc.provider.capabilities.statusEnquiry) {
      try { st = await withTimeout(lc.provider.getCharge(lc.ctx, p.provider_ref)); } catch { /* try again next sweep */ }
    }
    // Our deadline passed and the provider has not captured: expire locally (a later capture is still honoured).
    if ((!st || st.state === 'pending' || st.state === 'requires_action') && new Date(p.expires_at) < new Date()) st = { state: 'expired' };
    await this.db.tx(scope, (q) => q.query(`update payments set last_checked_at = now() where id = $1`, [paymentId]));
    if (st) await this.applyStatus(restaurantId, paymentId, st);
    return this.db.tx(scope, (q) => q.one(`select * from payments where id = $1`, [paymentId]));
  }

  /** Background safety net: webhooks can be late or lost. Run every ~15s. */
  async sweep() {
    const open = await this.db.tx(SYSTEM, (q) => q.query(
      `select id, restaurant_id from payments where status = any($1) and created_at < now() - interval '5 seconds'
        order by created_at limit 200`, [OPEN]));
    for (const p of open) { try { await this.refresh(p.restaurant_id, p.id); } catch { /* keep sweeping */ } }
    await this.db.tx(SYSTEM, (q) => q.query(
      `update orders set status = 'expired' where status = 'pending_payment' and created_at < now() - interval '30 minutes'
         and not exists (select 1 from payments p where p.order_id = orders.id and p.status = any($1))`, [OPEN]));
    return open.length;
  }

  /* ───────────── refunds ───────────── */

  async refund(a: { restaurantId: string; paymentId: string; amountCents?: number; reason: string; idempotencyKey: string;
                    actor: Actor; auto?: boolean; manual?: boolean }) {
    const scope = tenant(a.restaurantId);
    const prep = await this.db.tx(scope, async (q) => {
      const p = await q.one(`select * from payments where id = $1 for update`, [a.paymentId]);
      if (!p) throw new HttpError(404, 'not_found', 'Payment not found');
      const existing = await q.one(`select * from refunds where payment_id = $1 and idempotency_key = $2`, [a.paymentId, a.idempotencyKey]);
      if (existing) return { existing };
      if (!['paid', 'paid_duplicate'].includes(p.status) && !(p.status === 'failed' && p.needs_refund))
        throw new HttpError(409, 'not_refundable', 'Only captured payments can be refunded');
      const pending = (await q.one(`select coalesce(sum(amount_cents),0) as s from refunds where payment_id = $1 and status = 'pending'`, [p.id])).s;
      const remaining = p.amount_cents - p.refunded_cents - pending;
      const amount = a.amountCents ?? remaining;
      if (amount <= 0 || amount > remaining) throw new HttpError(422, 'invalid_amount', `Refundable balance is ${remaining}`);
      const r = await q.one(
        `insert into refunds (restaurant_id, payment_id, order_id, amount_cents, reason, status, auto, requested_by, idempotency_key)
         values ($1,$2,$3,$4,$5,'pending',$6,$7,$8) returning *`,
        [a.restaurantId, p.id, p.order_id, amount, a.reason, !!a.auto, a.actor.id ?? null, a.idempotencyKey]);
      const lc = await this.loadCtx(q, a.restaurantId, p.method, p.provider);
      return { p, r, lc, amount };
    });
    if ('existing' in prep && prep.existing) return prep.existing;
    const { p, r, lc, amount } = prep as any;

    let status: 'succeeded' | 'failed' | 'unsupported' = 'succeeded', providerRef: string | undefined, error: string | undefined;
    if (a.manual) providerRef = 'manual';
    else if (!lc) { status = 'failed'; error = 'provider not configured'; }
    else if (!lc.provider.capabilities.refunds) { status = 'unsupported'; error = 'Provider does not support API refunds — refund in the provider portal, then record it as a manual refund'; }
    else {
      try {
        const res: any = await withTimeout(lc.provider.refund(lc.ctx, p.provider_ref, amount, a.reason, r.id));
        if (res.ok) providerRef = res.providerRef; else { status = 'failed'; error = res.error; }
      } catch (e: any) {
        status = e instanceof ProviderUnsupported ? 'unsupported' : 'failed'; error = String(e?.message ?? e);
      }
    }
    return this.db.tx(scope, async (q) => {
      const row = await q.one(`update refunds set status = $2, provider_ref = $3, error = $4 where id = $1 returning *`, [r.id, status, providerRef ?? null, error ?? null]);
      if (status === 'succeeded') {
        const pay = await q.one(`update payments set refunded_cents = refunded_cents + $2,
            needs_refund = case when refunded_cents + $2 >= amount_cents then false else needs_refund end, updated_at = now()
            where id = $1 returning *`, [p.id, amount]);
        await this.ledger(q, pay, 'refund', -amount, { refundId: r.id, manual: !!a.manual });
        if (pay.status === 'paid') {
          await q.query(`update orders set refunded_cents = refunded_cents + $2,
              payment_status = case when refunded_cents + $2 >= total_cents then 'refunded' else 'partially_refunded' end where id = $1`, [p.order_id, amount]);
        }
      }
      await audit(q, a.restaurantId, a.actor, status === 'succeeded' ? 'refund.succeeded' : `refund.${status}`, 'payment', p.id,
        { amount, reason: a.reason, auto: !!a.auto, manual: !!a.manual, error });
      return row;
    }).then((row) => { publish(topics.order(p.order_id), { type: 'payment.updated' }); return row; });
  }

  get providers() { return [...this.registry.values()]; }
  provider(key: string): PaymentProvider | undefined { return this.registry.get(key); }
}
