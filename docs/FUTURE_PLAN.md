# Future plan — the full multi-vendor platform

**Status: parked, not deleted.** The complete platform described in the original brief is built and preserved in this repository.
Today the product is deliberately narrower (see `docs/BUYER_SELLER.md`). Nothing below was removed; it is switched off by `APP_PHASE`.

* Preserved snapshot: commit `5faee31` on this branch (local tag `full-platform-v1`; the remote refused the tag push, so use the commit hash).
* Switch it back on: set `APP_PHASE=full`. The buyer/seller marketplace keeps working in that mode too.

## What is parked (and where it lives)

| Capability | Where | Notes |
|---|---|---|
| Hotel / restaurant / event partner portals | `src/app/partner/**`, `src/lib/domain/{catalog,partners}.ts` | Inventory, pricing, reservations, waitlist demand, earnings, analytics, settings |
| Platform administrator portal | `src/app/admin/**`, `src/app/actions/admin.ts` | Approvals, customers, listings, transactions, buyback monitoring, disputes, commissions, reports, system + legal gates |
| Primary (venue-sold) last-minute inventory | `src/lib/domain/{inventory,orders,booking}.ts`, `/listings/[id]`, `/checkout/[orderId]` | Atomic holds, authorise → verify → capture |
| Venue-initiated buyback of confirmed bookings | `src/lib/domain/buyback.ts` | Consent, compensation, refund-then-release, registered-partners-only |
| Venue waitlist with fair allocation | `src/lib/domain/waitlist.ts` | First-come or highest-offer policies |
| Dynamic pricing engine (rule-based, pluggable) | `src/lib/domain/pricing.ts` | Predictive models not built |
| Partner payouts, commission engine, disputes | `src/lib/domain/{fees,finance}.ts` | Fee rules are data, not code |
| Original architecture, journeys, compliance table | `docs/ARCHITECTURE.md` | Still accurate for `APP_PHASE=full` |

## Original phases

1. **Core marketplace** — built (venue-sold hotel inventory, checkout, portals, seed data).
2. **Restaurants and events** — built.
3. **Buyback** — built; stays behind a legal-review gate.
4. **Optimisation** — rule-based pricing and analytics built. **Not built:** predictive pricing, property-management / channel-manager connectors, automated demand recommendations.

## How the two products fit together later

The buyer/seller marketplace is the *secondary market*; the partner platform is the *primary market*. They share accounts, payments, fee rules, notifications, the audit log and the reconciliation identity. When partners are onboarded:

1. Partners who are already registered (the registry that gates resale today) get a portal login instead of a back-office record.
2. A venue can set its own resale policy and markup cap (columns already exist on `venues`) instead of the operator doing it.
3. Venue-confirmed transfers can replace seller-declared proof, which is the biggest trust upgrade available.
4. Buyback and the waitlist then sit on top of both markets.

## Open items for whenever this resumes

* Legal review of buyback, ticket resale and the Terms (required before enabling regulated features).
* Real Stripe Connect onboarding and live webhook testing (the code is written, never run against Stripe).
* A real administrator UI (today a token-protected ops endpoint stands in for it).
* Accessibility audit, full device testing, production hosting decisions.
