import { md5Upper, safeEqual } from '../crypto.js';
import {
  WebhookRejected, ProviderUnsupported,
  type PaymentProvider, type ProviderCtx, type ChargeRequest, type ProviderStatus,
} from './types.js';

/**
 * PayHere (Sri Lanka) hosted-checkout adapter — Visa / Mastercard (+ others PayHere enables), 3-D Secure
 * handled entirely on PayHere's hosted page. Card data never reaches TableFlow.
 *
 * Implemented from PayHere's published checkout & notify (md5sig) scheme.
 * ⚠ Must be verified against the CURRENT PayHere documentation and exercised in the PayHere sandbox with
 *   a real merchant account before live use. Refund + retrieval use PayHere's OAuth merchant API, which
 *   requires per-merchant app credentials, and are intentionally not implemented here.
 *
 * Config:  config.merchantId        (non-secret)
 * Secrets: secrets.merchantSecret   (PayHere "Merchant Secret" from the domain/app settings)
 */
const SANDBOX_URL = 'https://sandbox.payhere.lk/pay/checkout';
const LIVE_URL = 'https://www.payhere.lk/pay/checkout';

const money = (c: number) => (c / 100).toFixed(2);               // PayHere wants "1500.00", no separators
const secretHash = (s: string) => md5Upper(s);

export class PayHere implements PaymentProvider {
  key = 'payhere'; method = 'card' as const; label = 'PayHere cards'; sandbox = false;
  capabilities = { dynamicQr: false, deepLink: false, statusEnquiry: false, refunds: false, partialRefunds: false,
    transactionListing: false, marketplaceSplit: false };

  async checkAvailability(ctx: ProviderCtx) {
    if (!ctx.config.merchantId || !ctx.secrets.merchantSecret) return { available: false, reason: 'not_configured' };
    if (ctx.mode === 'live' && !ctx.config.liveApproved) return { available: false, reason: 'live_not_approved' };
    return { available: true };
  }

  async createCharge(ctx: ProviderCtx, req: ChargeRequest) {
    const merchantId = String(ctx.config.merchantId);
    const amount = money(req.amountCents);
    const hash = md5Upper(merchantId + req.paymentId + amount + req.currency + secretHash(ctx.secrets.merchantSecret));
    const [first, ...rest] = (req.customer?.name ?? 'Guest').split(' ');
    return {
      providerRef: req.paymentId,       // PayHere echoes our order_id back; we use our payment id
      redirect: {
        url: ctx.mode === 'live' ? LIVE_URL : SANDBOX_URL, method: 'POST' as const,
        fields: {
          merchant_id: merchantId, return_url: req.returnUrl, cancel_url: req.cancelUrl, notify_url: req.notifyUrl,
          order_id: req.paymentId, items: `Order #${req.orderNumber} – ${ctx.restaurant.name}`,
          currency: req.currency, amount, hash,
          first_name: first || 'Guest', last_name: rest.join(' ') || '-', email: req.customer?.email ?? 'noreply@tableflow.lk',
          phone: req.customer?.phone ?? '0000000000', address: ctx.restaurant.name, city: ctx.restaurant.city, country: 'Sri Lanka',
        },
      },
    };
  }

  async getCharge(): Promise<ProviderStatus> {
    throw new ProviderUnsupported('PayHere status enquiry needs OAuth merchant API credentials');
  }

  peekRef(_h: Record<string, any>, raw: string) { return new URLSearchParams(raw).get('order_id'); }

  verifyWebhook(ctx: ProviderCtx, _h: Record<string, any>, raw: string) {
    const p = new URLSearchParams(raw);
    const g = (k: string) => p.get(k) ?? '';
    if (!ctx.secrets.merchantSecret) throw new WebhookRejected('merchant secret not configured');
    if (g('merchant_id') !== String(ctx.config.merchantId)) throw new WebhookRejected('merchant mismatch');
    const local = md5Upper(g('merchant_id') + g('order_id') + g('payhere_amount') + g('payhere_currency') +
      g('status_code') + secretHash(ctx.secrets.merchantSecret));
    if (!safeEqual(local, g('md5sig').toUpperCase())) throw new WebhookRejected('bad md5sig');
    const code = Number(g('status_code'));
    const amountCents = Math.round(parseFloat(g('payhere_amount')) * 100);
    const status: ProviderStatus =
      code === 2 ? { state: 'paid', amountCents } :
      code === 0 ? { state: 'pending' } :
      code === -1 ? { state: 'cancelled' } :
      { state: 'failed', failureCode: `payhere_${code}`, failureMessage: g('status_message') || 'Payment failed' };
    return { eventId: `${g('payment_id') || g('order_id')}:${code}`, providerRef: g('order_id'), type: `status_${code}`, status };
  }

  async refund(): Promise<never> {
    throw new ProviderUnsupported('Refund via PayHere merchant API is not enabled; refund in the PayHere portal and record it manually');
  }
}
