import { policyText, POLICY_LABEL, type CancellationPolicy } from "@/lib/domain/policies";

export const CANCELLATION_TEXT: Array<[string, string]> = (["flexible", "moderate", "strict", "non_refundable"] as CancellationPolicy[]).map((p) => [POLICY_LABEL[p], policyText(p)]);

type Page = { title: string; sections: Array<{ h: string; p: string[] }> };
export const PAGES: Record<string, Page> = {
  terms: { title: "Terms of use", sections: [
    { h: "1. Who we are", p: ["Eleventh Hour is a marketplace that lets independent hotels, restaurants and event organisers (\"Partners\") sell unsold inventory to customers. The contract for the room, table or ticket is between you and the Partner; we provide the platform, take payment as the Partner's collecting agent and charge a mandatory service fee."] },
    { h: "2. Prices and fees", p: ["All prices are in Australian dollars and include GST where applicable. The total you pay — the Partner's price plus our service fee — is shown before you confirm payment. There are no hidden fees."] },
    { h: "3. Bookings and holds", p: ["Your selected inventory is held for a short time while you pay. A booking is confirmed only once payment has been successfully captured and you receive a confirmation."] },
    { h: "4. Waitlists", p: ["Joining a waitlist is free and creates no obligation. Offers are time-limited. Each Partner publishes whether its waitlist is first-come-first-served or highest-offer-first. You only pay the offer price shown to you."] },
    { h: "5. Optional buyback offers", p: ["If you opt in at checkout, a Partner may offer you a full refund plus compensation to release your booking. Your booking is never cancelled without your separate, explicit acceptance of a specific offer. You may decline or ignore offers without penalty. This feature is only available once enabled by us following legal review."] },
    { h: "6. Australian Consumer Law", p: ["Nothing in these terms excludes, restricts or modifies any right or remedy you have under the Australian Consumer Law, including consumer guarantees. Cancellation terms shown on a listing apply to change-of-mind cancellations only."] },
    { h: "7. Event tickets", p: ["Tickets may not be resold outside the platform. Where a ticket is released through the platform to another customer, the resale price will not exceed the legal limit applicable to that event."] },
  ] },
  privacy: { title: "Privacy policy", sections: [
    { h: "What we collect", p: ["Account details (name, email, phone), booking and payment records, waitlist preferences, communication preferences and the consent records you give us (including the exact wording you agreed to). Card details are handled by Stripe and never stored by us."] },
    { h: "How we use it", p: ["To provide bookings, waitlists, refunds and invoices; to prevent fraud; to meet tax and legal obligations; and — only if you opt in — to send marketing. Partners receive the guest details needed to fulfil your booking, and a first name and preferences for waitlist management."] },
    { h: "Your rights", p: ["You can access your data from Profile → Download my data, correct it, change your notification and marketing preferences at any time, and ask us to delete your account. Some records (for example tax invoices) must be retained by law."] },
    { h: "Security", p: ["Passwords are hashed, sessions are signed and HTTP-only, access is role-based, administrative actions are written to an append-only audit log, and personal data is encrypted in transit."] },
  ] },
  cancellation: { title: "Cancellation policy", sections: [
    { h: "How cancellation works", p: ["Each listing shows one of four standard cancellation terms before you pay. The terms that applied when you booked are locked in and shown on your booking.", "Refunds go back to your original payment method. When a cancellation qualifies for a full refund, the service fee is refunded too; for partial refunds the service fee is refunded proportionally."] },
  ] },
  refunds: { title: "Refund policy", sections: [
    { h: "Standard refunds", p: ["Cancel from your booking page and any refund due under the listing's terms is issued automatically. Banks can take 5–10 business days to show the refund."] },
    { h: "Exceptional refunds and your statutory rights", p: ["If something goes wrong — for example the service isn't provided as described — request an exceptional refund from your booking. Our team reviews every request. This is in addition to your rights under the Australian Consumer Law, which apply regardless of a listing's cancellation terms.", "Chargebacks and disputes are investigated by our team and the Partner; please contact us first so we can fix it quickly."] },
    { h: "Venue-initiated releases", p: ["If a Partner asks you to release a booking and you accept, you receive a full refund of everything you paid plus the compensation shown in the offer."] },
  ] },
};
