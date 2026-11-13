import { aud } from "@/lib/util";

/** Text the customer actually agrees to — snapshotted verbatim into buyback_consents for evidentiary purposes. */
export function buybackOptInText(version: string): string {
  return `[Terms ${version}] I understand that, if demand increases, this venue may ask me (through Eleventh Hour) whether I would like to give up this booking in exchange for a full refund of everything I paid plus extra compensation shown to me in advance. I am under no obligation to accept any offer. Declining or ignoring an offer has no effect on my booking, and my booking is never cancelled without my separate, explicit acceptance of a specific offer.`;
}

export function buybackOfferText(version: string, p: { refundCents: number; compensationCents: number; expiresAt: string }): string {
  return `[Terms ${version}] I accept this offer to cancel my booking. I will receive a full refund of ${aud(p.refundCents)} to my original payment method plus ${aud(p.compensationCents)} compensation. This offer expires ${p.expiresAt}. I understand my booking stays unchanged until I accept.`;
}

export const SANDBOX_NOTICE =
  "Sandbox mode: payments use a test provider and move no real money. Sample venues, bookings and customers are demonstration data.";

export const LEGAL_REVIEW_NOTICE =
  "Customer buyback, automated reallocation and regulated ticket resale stay switched off until your legal advisers have reviewed them against the Australian Consumer Law, state ticket-resale legislation and the Privacy Act. An administrator must record the review reference to enable them.";
