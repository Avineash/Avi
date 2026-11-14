export type Method = 'lankaqr' | 'card';
export type Mode = 'sandbox' | 'live';

/** Everything a provider adapter needs for ONE restaurant. Secrets are decrypted in memory only. */
export interface ProviderCtx {
  restaurant: { id: string; name: string; city: string; slug: string };
  mode: Mode;
  config: Record<string, any>;          // non-secret: merchantId, mcc, …
  secrets: Record<string, string>;      // decrypted credentials
  feeBps: number;
}

export interface ChargeRequest {
  paymentId: string; orderId: string; orderNumber: number; tableLabel: string;
  amountCents: number; currency: string; expiresAt: Date;
  returnUrl: string; cancelUrl: string; notifyUrl: string;
  customer?: { name?: string; email?: string; phone?: string };
}
export interface ChargeResult {
  providerRef: string;
  qrPayload?: string;                   // LankaQR / EMV string to render as a QR
  deepLink?: string;                    // bank-app switch / payment link (same-device flow)
  redirect?: { url: string; method: 'GET' | 'POST'; fields?: Record<string, string> };
}
export type ProviderState = 'pending' | 'requires_action' | 'paid' | 'failed' | 'cancelled' | 'expired';
export interface ProviderStatus {
  state: ProviderState;
  amountCents?: number; feeCents?: number;
  failureCode?: string; failureMessage?: string;
}
export interface WebhookEvent { eventId: string; providerRef: string; type: string; status: ProviderStatus }
export interface RefundResult { ok: boolean; providerRef?: string; error?: string }
export interface ProviderTxn {
  providerRef: string; amountCents: number; state: ProviderState; refundedCents: number;
  feeCents: number; settledAt?: Date | null; settlementRef?: string | null;
}

export interface Capabilities {
  /** Generates a transaction-specific (dynamic) QR. If false the method is not offered. */
  dynamicQr: boolean;
  deepLink: boolean;
  statusEnquiry: boolean;
  refunds: boolean;
  partialRefunds: boolean;
  transactionListing: boolean;
  /** Provider+regulatory arrangement supports splitting platform fees at source. */
  marketplaceSplit: boolean;
}

export class ProviderUnsupported extends Error {}
export class ProviderError extends Error {}
export class WebhookRejected extends Error {}

export interface PaymentProvider {
  key: string;                          // stored in restaurant_payment_configs.provider
  method: Method;
  label: string;
  sandbox: boolean;                     // true => money never moves
  capabilities: Capabilities;
  checkAvailability(ctx: ProviderCtx): Promise<{ available: boolean; reason?: string }>;
  createCharge(ctx: ProviderCtx, req: ChargeRequest): Promise<ChargeResult>;
  /** Server-side status enquiry — the source of truth when a webhook is late or lost. */
  getCharge(ctx: ProviderCtx, providerRef: string): Promise<ProviderStatus>;
  /** UNVERIFIED peek used only to find which restaurant's secret should verify this webhook. */
  peekRef(headers: Record<string, any>, rawBody: string): string | null;
  /** Throws WebhookRejected unless authenticity is proven. */
  verifyWebhook(ctx: ProviderCtx, headers: Record<string, any>, rawBody: string): WebhookEvent;
  refund(ctx: ProviderCtx, providerRef: string, amountCents: number, reason: string, idempotencyKey: string): Promise<RefundResult>;
  listTransactions?(ctx: ProviderCtx, from: Date, to: Date): Promise<ProviderTxn[]>;
}
