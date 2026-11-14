# Buyer & seller marketplace (current product)

**Scope today:** two audiences only — **buyers** and **sellers**. No hotel / restaurant / event partner portal, no administrator portal.
The full venue-side platform is preserved and parked: see `docs/FUTURE_PLAN.md`. `APP_PHASE=full` switches it back on.

## The product in one paragraph

People who hold a hotel stay, a dining reservation or event tickets they can no longer use list them for resale. Other people buy them.
The buyer pays Eleventh Hour (**escrow**); the seller is paid only after delivery is confirmed (or automatically after the event, if no problem is reported).
If the seller doesn't deliver, the buyer is refunded automatically.

## Rule: resale only for registered partners

A booking can only be listed if its venue belongs to a **partner registered and approved on the platform**. Partners don't log in — an operator registers them
(ABN-checked) with their venues and **resale terms** (is resale allowed, markup cap, transfer instructions) through `/api/ops`.
Enforced at listing time, at search time (unapproved partners' listings never appear), at checkout, and in the DB schema (`venues` → `partners`). Tested in `tests/resale.test.ts`.

## Buyer journey
Browse/search (list or map; filters for date, price, seller rating) → listing (price the seller paid, savings, seller rating, transfer method, venue guidance, protection panel)
→ **Buy securely** (all-in price shown first; 10-minute hold) → pay (sandbox card or Stripe) → purchase page: *Paid · held in escrow* → seller delivers → **Confirm** (or report a problem) → review the seller.
Also: **alerts** ("tell me when a dinner for two under $400 is listed"), saved listings, receipts, notifications, cancel free until delivery.

## Seller journey
Seller profile (public name, private mobile, Seller Terms) → **List a booking** (registered venue only; face value paid; asking price ≤ the venue's cap; booking reference — can't be listed twice;
proof-of-purchase file; transfer method; four declarations) → sale notification → **deliver** (details and/or file) before the deadline → paid on confirmation → **withdraw**.
Failure to deliver or cancelling a paid sale refunds the buyer and adds a **strike**; 3 strikes suspends selling.

## Money flow (and why it reconciles)
Buyer pays `price + buyer fee` → captured → held. Seller ledger: `+price` and `−seller fee` stay in **escrow** until released. Platform fees: buyer fee + seller fee (GST-inclusive).
Refund → ledger and fees reversed, stock restored. Identity checked in tests and shown by `reconcile()`:
`captured − refunded − compensation = partner ledger + seller ledger + platform fees`.
Fees are **data** (`fee_rules`, payer `customer`/`seller`, flow `peer_resale`): defaults 5% buyer (min $2, max $30) and 8% seller. Nothing is hard-coded.

## Safety rails
| Risk | Control |
|---|---|
| Oversell / double purchase | `FOR UPDATE` on the listing + `quantity_available >= 0` check constraint; tested with concurrent buyers |
| Same booking listed twice | unique index on (venue, normalised booking reference) among live listings |
| Price gouging | per-venue markup cap (hotels/restaurants: face value; events: 110% default) enforced on create and on price edit |
| Seller disappears | delivery deadline → automatic full refund + strike (background job, idempotent, retries) |
| Bad delivery | buyer reports a problem → escrow frozen → operator resolves (refund + strike, or release) |
| Late/duplicate payment webhooks | provider idempotency keys; late authorisation for an expired hold is voided |
| Unregistered venues | listing, search and checkout all require an approved partner |
| Sensitive files | proof of purchase is never shown to buyers; delivery files only to the two parties; RLS blocks the binary columns for API roles |

## Operating it without an admin portal
`POST /api/ops` with `Authorization: Bearer $OPS_TOKEN`. Actions: `list_disputes`, `resolve_dispute`, `register_partner`, `register_venue`, `set_partner_status`,
`set_venue_resale`, `set_gate` (turn resale on — **requires a legal-review reference**), `set_seller_status`. Every mutation is written to the append-only audit log.
Resale ships **OFF** until `set_gate` is called; the demo seed enables it with a clearly labelled sandbox reference.

## Known limitations (be honest with users)
* **Proof is seller-declared.** Venues don't confirm transfers on the platform yet, so a venue may refuse a transfer. Escrow + refunds are the mitigation; venue confirmation is the planned upgrade.
* No identity verification beyond email + phone; no email verification flow; Google/Apple sign-in not wired.
* Stripe provider/webhook and email/SMS adapters are written but have not been run against the real services.
* Disputes are resolved by a human through the ops endpoint — there is no queue UI.
* Legal review is required before launch (peer resale of bookings, ticket-resale law, consumer law, Terms). The text in `/legal/*` is a draft.
