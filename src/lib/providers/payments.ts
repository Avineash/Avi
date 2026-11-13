import { randomUUID } from "node:crypto";
import { DomainError } from "@/lib/errors";

/**
 * Marketplace payment provider abstraction.
 *  - StripeProvider: PaymentIntents with manual capture (authorise → verify inventory → capture),
 *    "separate charges and transfers" for Connect payouts. Used when STRIPE_SECRET_KEY is set.
 *  - SandboxProvider: deterministic, clearly-labelled test provider. Moves no money. Used otherwise.
 * Every mutating call carries an idempotency key so retries can never double-charge / double-refund.
 */
export interface PaymentProvider {
  name: "sandbox" | "stripe";
  createIntent(a: { orderId: string; amountCents: number; currency: string; idempotencyKey: string; customerEmail?: string }): Promise<{ ref: string; clientSecret?: string }>;
  capture(ref: string, amountCents: number, idempotencyKey: string): Promise<void>;
  cancel(ref: string, idempotencyKey: string): Promise<void>;
  refund(ref: string, amountCents: number, idempotencyKey: string): Promise<{ ref: string }>;
  /** Pay a customer buyback compensation. `paid=false` means the obligation is recorded but needs manual disbursement. */
  payCompensation(a: { customerId: string; amountCents: number; idempotencyKey: string }): Promise<{ ref: string; paid: boolean }>;
  transferToPartner(a: { stripeAccountId: string | null; amountCents: number; idempotencyKey: string }): Promise<{ ref: string }>;
}

// ── Sandbox ──────────────────────────────────────────────────────────────
/** Fault injection for tests / demos: make the next N calls of a kind fail. */
type Faults = { refund: number; capture: number; compensation: number };
type G = typeof globalThis & { __eh_faults?: Faults; __eh_sbx?: Map<string, string> };
export const sandboxFaults: Faults = ((globalThis as G).__eh_faults ??= { refund: 0, capture: 0, compensation: 0 });
const seen = ((globalThis as G).__eh_sbx ??= new Map<string, string>());

function idem(kind: string, key: string, mk: () => string): string {
  const k = `${kind}:${key}`;
  if (!seen.has(k)) seen.set(k, mk());
  return seen.get(k)!;
}
function maybeFail(kind: keyof Faults) {
  if (sandboxFaults[kind] > 0) { sandboxFaults[kind]--; throw new DomainError("PROVIDER", `Sandbox ${kind} failure (injected)`); }
}

export const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  async createIntent(a) { return { ref: idem("pi", a.idempotencyKey, () => `pi_sbx_${randomUUID().slice(0, 18)}`) }; },
  async capture(_ref, _amt, key) { maybeFail("capture"); idem("cap", key, () => "ok"); },
  async cancel(_ref, key) { idem("void", key, () => "ok"); },
  async refund(_ref, _amt, key) { maybeFail("refund"); return { ref: idem("re", key, () => `re_sbx_${randomUUID().slice(0, 18)}`) }; },
  async payCompensation(a) { maybeFail("compensation"); return { ref: idem("comp", a.idempotencyKey, () => `comp_sbx_${randomUUID().slice(0, 14)}`), paid: true }; },
  async transferToPartner(a) { return { ref: idem("tr", a.idempotencyKey, () => `tr_sbx_${randomUUID().slice(0, 16)}`) }; },
};

/** Stripe's published test card numbers, used by the sandbox checkout form. */
export const SANDBOX_CARDS: Record<string, { ok: boolean; message?: string }> = {
  "4242424242424242": { ok: true },
  "5555555555554444": { ok: true },
  "4000000000000002": { ok: false, message: "Your card was declined." },
  "4000000000009995": { ok: false, message: "Your card has insufficient funds." },
  "4000000000000069": { ok: false, message: "Your card has expired." },
};

// ── Stripe ───────────────────────────────────────────────────────────────
function stripeProvider(secret: string): PaymentProvider {
  let client: any;
  const stripe = async () => (client ??= new (await import("stripe")).default(secret));
  return {
    name: "stripe",
    async createIntent(a) {
      const s = await stripe();
      const pi = await s.paymentIntents.create({
        amount: a.amountCents, currency: a.currency, capture_method: "manual",
        automatic_payment_methods: { enabled: true }, // cards, Apple Pay, Google Pay where supported
        receipt_email: a.customerEmail, metadata: { order_id: a.orderId }, transfer_group: a.orderId,
      }, { idempotencyKey: a.idempotencyKey });
      return { ref: pi.id, clientSecret: pi.client_secret ?? undefined };
    },
    async capture(ref, amt, key) { await (await stripe()).paymentIntents.capture(ref, { amount_to_capture: amt }, { idempotencyKey: key }); },
    async cancel(ref, key) { await (await stripe()).paymentIntents.cancel(ref, {}, { idempotencyKey: key }); },
    async refund(ref, amt, key) {
      const r = await (await stripe()).refunds.create({ payment_intent: ref, amount: amt }, { idempotencyKey: key });
      return { ref: r.id };
    },
    async payCompensation(a) {
      // Stripe cannot push funds to an arbitrary customer. Record the obligation; operations disburse it (bank transfer / account credit).
      return { ref: `manual_${a.idempotencyKey}`, paid: false };
    },
    async transferToPartner(a) {
      if (!a.stripeAccountId) throw new DomainError("CONFIG", "Partner has no connected Stripe account");
      const t = await (await stripe()).transfers.create({ amount: a.amountCents, currency: "aud", destination: a.stripeAccountId }, { idempotencyKey: a.idempotencyKey });
      return { ref: t.id };
    },
  };
}

export function getProvider(): PaymentProvider {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? stripeProvider(key) : sandboxProvider;
}
export const isSandbox = () => !process.env.STRIPE_SECRET_KEY;
export function providerByName(name: string): PaymentProvider {
  return name === "stripe" ? stripeProvider(process.env.STRIPE_SECRET_KEY ?? "") : sandboxProvider;
}
