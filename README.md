# Eleventh Hour

A premium, mobile-first marketplace where people **buy and sell last-minute hotel stays, restaurant reservations and event tickets** — Melbourne first.
Next.js 15 · TypeScript · Tailwind · PostgreSQL (Supabase-compatible) · Stripe Connect.

> **Current scope: buyers and sellers only** (`docs/BUYER_SELLER.md`). The venue-side platform — partner portals, admin portal, primary inventory, buyback — is built, parked and one switch away (`APP_PHASE=full`, `docs/FUTURE_PLAN.md`).
>
> **Status (original build):** working MVP covering the four phases in the brief (see `docs/ARCHITECTURE.md` §7–8 for exactly what is and isn't built). Payments run in a clearly-labelled **sandbox** unless Stripe keys are set; seeded venues, customers and bookings are demonstration data, not real transactions.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000 — embedded Postgres (PGlite), auto-migrated and seeded with Melbourne demo data
npm test               # 62 tests on PGlite
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test   # same suite on real Postgres (true concurrency)
```

Demo accounts (password `Password123!`, buyer/seller mode): `ava@` (buyer, a purchase awaiting delivery), `ben@` (buyer, one to confirm), `chloe@` / `dev@` / `maya@eleventhhour.test` (sellers). Set `APP_PHASE=full` for the venue-side demo accounts. Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` declines.

Try the headline flow: as `ava@` buy a listing → as its seller (e.g. `maya@`) **My sales → Deliver** → back as `ava@` **Confirm** → as `maya@` **Earnings → Withdraw**. Or become a seller as `ben@`: **Sell → List a booking** (try an asking price above face value at a restaurant — it is refused).

## Production

Copy `.env.example`. Registering venues/partners, resolving disputes and enabling resale (needs a legal-review reference) are done via `POST /api/ops` — see `docs/BUYER_SELLER.md`. Set `OPS_TOKEN` (operator endpoint) and `DATABASE_URL` (Supabase/Postgres), run `npm run db:migrate`, set `SESSION_SECRET`, `STRIPE_*`, `RESEND_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SANDBOX=false`, and schedule `POST /api/cron/maintenance` (`Authorization: Bearer $CRON_SECRET`) every minute. Point Stripe webhooks at `/api/webhooks/stripe`.

**Before real customers:** legal review (buyback / reallocation / ticket resale stay OFF until an admin records a review reference), real Terms/Privacy, Stripe Connect onboarding, GST/accounting sign-off, accessibility audit. See `docs/ARCHITECTURE.md`.

`npm audit` reports advisories in Next's bundled `postcss` (build-time) and `sharp` (image optimiser, unused — `images.unoptimized`); upgrading to Next 16 clears them.
