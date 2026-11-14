# TableFlow — Scan. Order. Pay. Enjoy.

Multi-tenant **QR table ordering + LankaQR / card payments** for Sri Lankan cafés and restaurants.
Customers scan a table QR, order in **Sinhala, Tamil or English**, pay, and track their order — no app to install.
Staff get a live kitchen display, a dashboard, refunds, reconciliation and a payment ledger. TableFlow staff get a
platform console to approve restaurants, configure payment providers and watch revenue.

> ## ⚠️ This is a working prototype with **simulated (sandbox) payments**
> Every payment in this build is simulated by in-repo "bank" and "gateway" stand-ins. **No real money moves**, and
> nothing here is a live bank or gateway transaction. The sandbox providers are blocked from live mode by code *and*
> by the database config rules. Real-money payments require signing merchant agreements with an acquiring bank / PSP,
> implementing that provider's adapter against *their* sandbox, and the go-live checklist in
> [docs/PRODUCTION-CHECKLIST.md](docs/PRODUCTION-CHECKLIST.md).

## Quick start (zero infrastructure)

Requires Node ≥ 22.

```bash
npm install
npm run seed            # creates the demo café + 14 days of sandbox history (embedded Postgres, ./apps/api/data)
npm run dev             # API on :4000, web on :3000
```

Open <http://localhost:3000>.

| Try this | Where |
|---|---|
| Customer: scan table T1 | `/t/demo-table-1` |
| Café dashboard (owner) | `/login` → `owner@ceylonbrew.lk` |
| Kitchen display | `kitchen@ceylonbrew.lk` → `/kitchen` |
| Platform admin | `admin@tableflow.lk` |
| Password for all demo accounts | `TableFlow-demo-1` |

With a real PostgreSQL instead of the embedded one: `DATABASE_URL=postgres://… npm run seed && npm run dev`.

### The 90-second demo
1. Open `/t/demo-table-1` on your phone-sized browser → add **Chicken Kottu** → *View order*.
2. **Pay with LankaQR** → a dynamic EMVCo QR appears (the order is **not** paid yet).
3. Tap **Open banking app** (the same-phone flow) → the *sandbox bank* decodes the QR, validates its CRC → **Authorise**.
4. The sandbox bank calls our **HMAC-signed webhook**; only then does the order flip to *received* and appear on the kitchen display (sound chime).
5. In `/kitchen`, advance Received → Preparing → Ready → Served — the customer's phone updates live.
6. As admin: **Overview → Sandbox controls → LankaQR outage ON**, start a new order: customers see *"LankaQR is temporarily unavailable…"* with card pre-selected.
7. In the bank scenarios, choose **"lose the webhook"**: the order still becomes paid via server-side status enquiry.

## What is where

```
apps/api      Fastify + TypeScript API (PostgreSQL, RLS, payment abstraction, SSE)      → docs/ARCHITECTURE.md
apps/web      Next.js 15 / React 19 / Tailwind: customer app, kitchen, dashboard, admin
infra/        docker-compose, Dockerfiles, Caddyfile, .env.example
scripts/      e2e.mjs (Playwright journey), tour.mjs (screen smoke test), gen-food.mjs
docs/         ARCHITECTURE · DATABASE · PAYMENTS · API · JOURNEYS · DEPLOYMENT · TESTING · PRODUCTION-CHECKLIST
```

## Commands

| | |
|---|---|
| `npm test` | API test suite (46 tests). `TEST_DATABASE_URL=postgres://…` runs it on real PostgreSQL; unset = embedded PGlite |
| `npm run typecheck` / `npm run build` | whole workspace |
| `node scripts/e2e.mjs` | browser journey against a running stack (needs Playwright + seeded demo) |

## Honest status

| Area | State |
|---|---|
| Ordering, menu, tables/QR, kitchen, dashboards, admin, i18n, theming | Built and exercised end-to-end |
| Payments: abstraction, state machine, ledger, refunds, expiry, idempotency, duplicate protection, reconciliation | Built and tested **against simulated providers** |
| PayHere card adapter | Implemented from PayHere's published checkout/notify scheme and unit-tested; **never run against PayHere's sandbox** — verify before relying on it. Refunds not implemented (needs merchant OAuth credentials) |
| LankaQR acquirer adapter | **Deliberate stub.** Each bank's dynamic-QR API is issued under NDA at onboarding. It reports itself unavailable, which routes customers to card checkout |
| Sinhala / Tamil strings | Written by an AI assistant — **must be reviewed by native speakers** before launch |
| Food photos | Generated placeholder art; restaurants upload real photos in the menu editor |
| Fee, plan and tax figures | Illustrative (VAT 18 %, service 10 % are configurable defaults — confirm with an accountant) |
