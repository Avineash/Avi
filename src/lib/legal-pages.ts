import { policyText, POLICY_LABEL, type CancellationPolicy } from "@/lib/domain/policies";

export const CANCELLATION_TEXT: Array<[string, string]> = (["flexible", "moderate", "strict", "non_refundable"] as CancellationPolicy[]).map((p) => [POLICY_LABEL[p], policyText(p)]);

type Page = { title: string; sections: Array<{ h: string; p: string[] }> };
export const PAGES: Record<string, Page> = {
  terms: { title: "Terms of use", sections: [
    { h: "1. Who we are", p: ["Eleventh Hour is a marketplace that lets independent hotels, restaurants and event organisers (\"Partners\") sell unsold inventory to customers. The contract for the room, table or ticket is between you and the Partner; we provide the platform, take payment as the Partner's collecting agent and charge a mandatory service fee."] },
    { h: "2. Prices and fees", p: ["All prices are in Australian dollars and include GST where applicable. The total you pay — the Partner's price plus our service fee — is shown before you confirm payment. There are no hidden fees."] },
    { h: "3. Bookings and holds", p: ["Your selected inventory is held for a short time while you pay. A booking is confirmed only once payment has been successfully captured and you receive a confirmation."] },
    { h: "4. Waitlists", p: ["Joining a waitlist is free and creates no obligation. Offers are time-limited. Each Partner publishes whether its waitlist is first-come-first-served or highest-offer-first. You only pay the offer price shown to you."] },
    { h: "5. Optional buyback offers", p: ["If you opt in at checkout, a Partner may offer you a full refund plus compensation to release your booking. Your booking is never cancelled without your separate, explicit acceptance of a specific offer. You may decline or ignore offers without penalty. This feature is only available once enabled by us following legal review.","Resale and reallocation are only possible for bookings and tickets sold through Eleventh Hour by a partner that is registered, verified and approved on the platform. Nothing bought elsewhere can be listed, released or resold here, and if a partner is suspended or removed no further offers are made on its behalf."] },
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

/** Buyer/seller phase wording. Draft for legal review, like the rest. */
export const MARKET_PAGES: Record<string, Page> = {
  terms: { title: "Terms of use", sections: [
    { h: "1. What Eleventh Hour is", p: ["Eleventh Hour is an online marketplace where individuals (\"Sellers\") offer hotel stays, dining reservations and event tickets they hold to other individuals (\"Buyers\"). The sale is between Buyer and Seller. We provide the platform, hold the Buyer's payment in escrow, and charge fees. We are not the venue and do not operate the venues."] },
    { h: "2. Registered venues only", p: ["Resale is only possible for bookings and tickets at venues registered with Eleventh Hour by an approved partner. Bookings or tickets bought elsewhere, or at unregistered or suspended venues, cannot be listed, and listings at a venue that is later suspended are withdrawn."] },
    { h: "3. Prices and fees", p: ["Prices are in Australian dollars. Buyers pay the Seller's asking price plus a service fee shown before payment. Sellers pay a fee deducted from the sale price. Platform fees include GST. A Seller's price may not exceed the cap set for the venue (hotels and restaurants: what the Seller paid; events: a capped multiple of face value)."] },
    { h: "4. Escrow, delivery and release", p: ["The Buyer pays Eleventh Hour. The Seller must deliver the booking or ticket within the stated deadline. If they do not, the Buyer is refunded in full automatically. The Seller is paid when the Buyer confirms delivery, or automatically after the event begins if no problem has been reported."] },
    { h: "5. Seller obligations", p: ["Sellers must hold the booking, be permitted to transfer it, provide accurate information and proof of purchase, and deliver on time. Failed or cancelled sales are recorded as strikes and repeated strikes suspend selling. Sellers must not list the same booking twice or sell anything they do not hold."] },
    { h: "6. Disputes", p: ["A Buyer can report a problem after delivery until 24 hours after the event starts. Funds stay frozen while we review. We may refund the Buyer, release funds to the Seller, or ask either party for information."] },
    { h: "7. Australian Consumer Law", p: ["Nothing in these terms excludes, restricts or modifies any right or remedy a Buyer has under the Australian Consumer Law. Where a Seller is a private individual, some consumer guarantees may not apply to the Seller; our buyer protection operates in addition to the law."] },
    { h: "8. Event tickets", p: ["Tickets may only be resold at or below the legal limit applicable to the event. Eleventh Hour may remove any listing it believes breaches ticketing laws or a venue's terms."] },
  ] },
  privacy: { title: "Privacy policy", sections: [
    { h: "What we collect", p: ["Account details, seller profile details (public name, private mobile), the booking references and proof-of-purchase files Sellers upload, delivery details and files, payment and refund records, reviews, alerts and notification preferences. Card details are handled by Stripe and never stored by us."] },
    { h: "Who sees what", p: ["Buyers see a Seller's public name, rating and history. Sellers see a Buyer's first name and initial. Proof-of-purchase files are private to Eleventh Hour and are never shown to Buyers. Delivery files are visible only to the Buyer and Seller of that sale."] },
    { h: "Your rights", p: ["You can download your data from Profile, correct it, change preferences and ask us to delete your account. We must keep some records (for example, payments and tax invoices) for legal reasons."] },
    { h: "Security", p: ["Passwords are hashed, sessions are signed and HTTP-only, and administrative actions are written to an append-only audit log."] },
  ] },
  cancellation: { title: "Cancellation & delivery policy", sections: [
    { h: "Buyers", p: ["You can cancel for a full refund, including our service fee, at any time before the Seller delivers. After delivery, the sale is final unless you report a problem."] },
    { h: "Sellers", p: ["You can cancel a paid sale before delivery, but the Buyer is refunded in full and a strike is added to your account. If you do not deliver by the deadline the Buyer is refunded automatically and a strike is added."] },
    { h: "Deadlines", p: ["Delivery must happen within 24 hours of the sale and before the event, whichever is earlier. Listings close 2 hours before the start."] },
  ] },
  refunds: { title: "Refunds & buyer protection", sections: [
    { h: "When you are refunded in full", p: ["You cancel before delivery; the Seller cancels or fails to deliver; or a dispute is decided in your favour. Refunds include our service fee and go back to your original payment method (banks may take 5–10 business days)."] },
    { h: "Reporting a problem", p: ["If the booking or ticket does not work, is not as described, or has been used or cancelled, report it from your purchase page. Your payment stays in escrow while we review."] },
    { h: "Your statutory rights", p: ["These protections are in addition to your rights under the Australian Consumer Law, which always apply."] },
  ] },
};
