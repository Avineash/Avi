# Eleventh Hour — architecture, journeys & compliance notes

## 1. Information architecture

```
Public            /  /hotels  /restaurants  /events  /search (list + map)  /listings/[id]
                  /waitlist/[listingId]  /how-it-works  /partners  /partners/register
                  /about  /contact  /legal/{terms,privacy,cancellation,refunds}  /login  /register
Checkout          /checkout/[orderId]   (hold countdown, itemised price + mandatory fee, sandbox/Stripe payment)
Customer          /account  /account/bookings(?tab=upcoming|previous)  /account/bookings/[id](+/invoice)
                  /account/waitlists  /account/offers  /account/saved  /account/payments  /account/profile
Partner portal    /partner  /inventory(+/new,/[id])  /pricing  /reservations  /waitlist  /buybacks
                  /earnings  /analytics  /settings
Admin portal      /admin  /partners  /customers  /listings  /transactions  /buybacks
                  /disputes  /commissions  /reports  /system
API               /api/webhooks/stripe  /api/cron/maintenance  /api/listings/[id]/stream (SSE)
                  /api/art/[slug] (generated covers)  /api/account/export  /api/admin/{doc,export}
```

Roles: `customer`, `partner` (hotel | restaurant | event), `admin`. Enforced three times: edge middleware (fast bounce), every portal layout (`requirePermission`) and every server action (`actionUser` / `actionPartner`) — plus ownership checks inside the domain services.

## 2. Code layout

```
db/migrations/001_init.sql      full relational schema (constraints, partial unique indexes, audit trigger)
db/migrations/002_defaults.sql  fee rules, pricing rules, feature gates, special events (DATA, admin-editable)
db/migrations/003_rls.sql       Supabase row-level security (defence in depth)
src/lib/domain/*                business logic — the only place money / inventory state changes
  inventory.ts   state machine + atomic holds (FOR UPDATE SKIP LOCKED) + realtime fan-out
  orders.ts      order + reservations + pending payment, locked prices
  booking.ts     checkout, authorise→verify→capture, expiry, cancellation, refunds, accounting reversals
  waitlist.ts    ranking policies, time-limited offers, cascade, simple "release to waitlist"
  buyback.ts     eligibility, quote, proposal, admin approval, consent, refund→compensation→release→resale
  fees.ts / pricing.ts / policies.ts / finance.ts / maintenance.ts / analytics.ts / search.ts
src/lib/providers/payments.ts   Stripe (manual capture, separate charges & transfers) + sandbox provider
src/app/**                      Next.js App Router pages, server actions (src/app/actions), route handlers
tests/                          vitest suites (run on PGlite, or real Postgres via TEST_DATABASE_URL)
```

## 3. Data model (summary)

| Area | Tables |
|---|---|
| Identity | `users`, `partners`, `partner_verifications` |
| Catalogue | `venues`, `listings`, `inventory_units`, `inventory_events`, view `listing_availability`, `pricing_rules`, `special_events`, `price_history`, `promotions` |
| Orders & money | `orders`, `reservations`, `payments`, `refunds`, `refund_requests`, `compensation_payments`, `fee_rules`, `platform_fees`, `ledger_entries`, `partner_payouts`, `disputes` |
| Waitlist & buyback | `waitlist_entries`, `waitlist_offers`, `buyback_offers`, `buyback_consents` |
| Engagement & ops | `favourites`, `reviews`, `notifications`, `audit_logs` (append-only), `system_settings`, `integration_events`, `processed_webhooks` |

Money is integer cents. Key database-level guarantees: `reservations_one_live_per_unit` (partial unique index — a unit can have one live reservation), one pending offer per unit, one open buyback per reservation, `refunded_cents <= captured_cents`, unique idempotency keys on orders/payments/refunds/payouts/compensation, audit log trigger rejects UPDATE/DELETE.

### Inventory state machine
`available → held → booked → completed`; `booked → buyback_requested → buyback_pending → (booked | cancelled)`; `booked → cancelled → released → (waitlisted | available)`; `waitlisted → held → booked`. Illegal transitions throw; every transition is logged in `inventory_events`.

### Money identity (reconciliation)
`captured − refunded − compensation = Σ partner ledger + Σ platform fees` — checked in tests after every flow and shown live in the admin portal.

## 4. Key flows

**Booking**: hold (atomic) → order/reservation/payment rows (one tx) → provider intent (outside tx) → customer pays → *authorised* → re-verify the customer still holds every unit → *capture* → confirm (units booked, fees, ledger, notifications). A late authorisation for an expired hold is voided, never booked. All provider calls carry idempotency keys; webhooks are de-duplicated.

**Cancellation**: policy → refund fraction → reservation cancelled, unit `cancelled` → refund executed → accounting reversed proportionally → *only then* unit released and offered to the waitlist (or relisted). A failed refund leaves the unit `cancelled`; the reconciler retries with the same key.

**Waitlist**: join only when sold out; partner publishes `first_come` or `highest_offer`; offer = the listed (or buyback) price, never the customer's maximum; countdown; expiry/decline cascades; unpaid accepted offers cascade too.

**Buyback** (feature-gated): partner sees profitable opportunities among *opted-in* bookings → proposal (compensation within partner min/max; event tickets capped at legal multiple and always admin-approved) → customer receives a transparent optional offer → accept (separate explicit consent, terms snapshot stored) / reject (no effect) / ignore (expires) → refund → compensation → release → time-limited offer to the policy-selected waitlisted customer → payment → fees + ledger. The buyback fee is a separate rule; the payment-processing cost of the original charge is borne by the partner and recovered by the platform.

## 5. User journeys

**Customer** — find tonight's deal (search/map/filters) → listing (live availability, all-in price, terms) → checkout (test card) → booking page (cancel with refund preview, invoice, review after completion) → if sold out: waitlist (max price, preferences, channels) → offer with countdown → accept & pay.
**Partner** — apply (ABN checksum + document) → admin approval → add venue → publish listing (floor/ceiling prices, deadline, policy, buyback eligibility) → monitor (dashboard, reservations, waitlist demand) → price (suggestions explained, one-click apply / manual override / auto) → buyback opportunities → earnings & payouts.
**Admin** — approve partners (view documents; audited) → monitor alerts, ledger reconciliation, buybacks → approve exceptional buybacks/refunds → handle disputes → edit commission rules → flip legal gates (requires a legal-review reference) → review audit log.

## 6. Compliance posture (design intent — **not legal advice**)

| Area | What the product does | What still needs a lawyer / accountant |
|---|---|---|
| Australian Consumer Law | Total price (incl. mandatory fee, GST) shown before payment; cancellation terms shown and locked at purchase; policies say they never limit consumer guarantees; exceptional-refund request flow | Final wording of Terms, refund & cancellation policies; drip-pricing review |
| Buyback / reallocation | Off by default; needs admin switch **and** a recorded legal-review reference; opt-in at checkout with stored wording; separate acceptance; no penalty for declining; refund-then-release ordering | **Legal review before enabling** (required by the brief) |
| Ticket resale | Separate gate; price cap (default 110% of face value, configurable) enforced; always admin-approved | Confirm the cap and scope per state/event (e.g. Victorian declared events) |
| Restaurant deposits | Dining packages are prepaid in full; terms shown | Deposit/no-show rules per venue |
| GST & invoicing | GST-inclusive pricing, 1/11 GST on fees and (if registered) partner supply; tax-invoice view; GST report by month | Agent vs principal analysis, invoice format, BAS treatment |
| Privacy Act | Data export endpoint, preference management, consent records, role-based access, audit log, no card data stored | Privacy policy adoption, retention schedule, deletion workflow, breach plan |
| Payments | Stripe Connect manual capture; idempotency; webhook signature verification | Stripe Connect onboarding, KYC, PCI SAQ-A scope |
| Accessibility | Semantic HTML, labelled controls, skip link, focus rings, live regions, reduced-motion, table fallbacks for charts | WCAG 2.2 AA audit with assistive-tech testing |

## 7. Phases

1. **Core marketplace** ✅ auth + RBAC, partner onboarding, hotel listings, availability, checkout, sandbox/Stripe payments, customer/partner/admin portals, Melbourne seed.
2. **Restaurants & events** ✅ category-specific listings (tables / tickets), quantity booking, waitlists.
3. **Buyback** ✅ consent, offers, compensation, reallocation, reconciliation (gated).
4. **Optimisation** 🟡 rule-based pricing engine with explanations + pluggable model interface, analytics, demand signals. *Not built:* predictive models, PMS / channel-manager connectors, automated demand recommendations beyond the buyback opportunity finder.

## 8. Known limitations (honest list)

* Stripe provider and webhook are implemented but **have not been run against Stripe** here; test with `stripe listen` in test mode. Compensation to customers cannot be pushed by Stripe — it is recorded and flagged for manual disbursement in Stripe mode.
* Google / Apple sign-in are not wired (buttons are disabled); plan is Supabase Auth. Email + password is complete.
* Map is a built-in SVG (no key needed); swap `MapView` for Mapbox/Google Maps.
* Email (Resend) and SMS (Twilio) adapters are untested without credentials; without them notifications are in-app only and marked `skipped`.
* Rate limiting and realtime fan-out are in-process; use Redis / Supabase Realtime when running multiple instances.
* The embedded demo database is in-memory and reseeds on restart.
* Partner documents are stored in Postgres (`bytea`); move to object storage for production.
