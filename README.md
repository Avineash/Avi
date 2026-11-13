# Eleventh Hour

A premium, mobile-first, multi-vendor marketplace for **last-minute hotel rooms, restaurant tables and events** — Melbourne first.
Next.js 15 · TypeScript · Tailwind · PostgreSQL (Supabase-compatible) · Stripe Connect.

> **Status:** working MVP covering the four phases in the brief (see `docs/ARCHITECTURE.md` §7–8 for exactly what is and isn't built). Payments run in a clearly-labelled **sandbox** unless Stripe keys are set; seeded venues, customers and bookings are demonstration data, not real transactions.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000 — embedded Postgres (PGlite), auto-migrated and seeded with Melbourne demo data
npm test               # 62 tests on PGlite
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test   # same suite on real Postgres (true concurrency)
```

Demo accounts (password `Password123!`): `ava@` / `ben@eleventhhour.test` (customers — Ava holds the $180 room, Ben is waitlisted at $300), `hotel@` / `restaurant@` / `events@` (partners), `admin@`. Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` declines.

Try the headline flow: sign in as `hotel@` → **Buyback requests** → send the offer → as `ava@` → **Offers** → accept → as `ben@` → **Offers** → accept & pay → as `admin@` → overview shows the ledger **Balanced**.

## Production

Copy `.env.example`. Set `DATABASE_URL` (Supabase/Postgres), run `npm run db:migrate`, set `SESSION_SECRET`, `STRIPE_*`, `RESEND_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SANDBOX=false`, and schedule `POST /api/cron/maintenance` (`Authorization: Bearer $CRON_SECRET`) every minute. Point Stripe webhooks at `/api/webhooks/stripe`.

**Before real customers:** legal review (buyback / reallocation / ticket resale stay OFF until an admin records a review reference), real Terms/Privacy, Stripe Connect onboarding, GST/accounting sign-off, accessibility audit. See `docs/ARCHITECTURE.md`.

`npm audit` reports advisories in Next's bundled `postcss` (build-time) and `sharp` (image optimiser, unused — `images.unoptimized`); upgrading to Next 16 clears them.
