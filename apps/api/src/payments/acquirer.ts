import {
  ProviderUnsupported, type PaymentProvider, type ProviderCtx, type ChargeRequest,
} from './types.js';

/**
 * LankaQR via a licensed acquiring bank / PSP — INTEGRATION SEAM.
 *
 * Each Sri Lankan acquirer exposes its own dynamic-QR API (create QR for an amount + bill reference,
 * notify / query / refund). Those contracts are issued under NDA at merchant onboarding, so this adapter
 * is a deliberate stub: until `config.apiBase` and `secrets.apiKey` exist it reports itself unavailable,
 * which automatically routes customers to card checkout. Implement createCharge/getCharge/verifyWebhook/refund
 * against the bank's sandbox, using `buildDynamicQr()` from ../emv.ts if the bank wants us to compose the
 * payload ourselves (static merchant-account template supplied by the bank).
 */
export class LankaQrAcquirer implements PaymentProvider {
  key = 'lankaqr_acquirer'; method = 'lankaqr' as const; label = 'LankaQR (bank acquirer)'; sandbox = false;
  capabilities = { dynamicQr: false, deepLink: false, statusEnquiry: false, refunds: false, partialRefunds: false,
    transactionListing: false, marketplaceSplit: false };
  async checkAvailability(ctx: ProviderCtx) {
    if (!ctx.config.apiBase || !ctx.secrets.apiKey) return { available: false, reason: 'not_configured' };
    // Honest default: even when credentials exist, dynamic QR stays off until this adapter is implemented.
    return { available: false, reason: 'dynamic_qr_not_implemented' };
  }
  async createCharge(_c: ProviderCtx, _r: ChargeRequest): Promise<never> { throw new ProviderUnsupported('acquirer API not implemented'); }
  async getCharge(): Promise<never> { throw new ProviderUnsupported('acquirer API not implemented'); }
  peekRef() { return null; }
  verifyWebhook(): never { throw new ProviderUnsupported('acquirer API not implemented'); }
  async refund(): Promise<never> { throw new ProviderUnsupported('acquirer API not implemented'); }
}
