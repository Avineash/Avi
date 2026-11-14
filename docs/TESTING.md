# Automated testing strategy

| Layer | Tooling | What it proves | Where |
|---|---|---|---|
| Unit | Vitest | EMV/CRC-16 (check value `29B1`), price maths, AES-GCM, scrypt, CSV-injection guard, circuit breaker, **PayHere md5sig accept/forge/tamper** | `apps/api/test/core.test.ts` |
| API integration | Vitest + Fastify `inject` on **real PostgreSQL 16** (and PGlite) | Whole money path and security rules, each test file on a fresh database | `payments.test.ts`, `security.test.ts` |
| Browser E2E | Playwright | Scan → order → LankaQR → bank app → webhook → kitchen → served → receipt; card + 3DS; outage fallback; Sinhala | `scripts/e2e.mjs` |
| Screen smoke | Playwright | Every staff/admin page loads with no console errors or failed requests, desktop + dark mobile | `scripts/tour.mjs` |

Run: `TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test` (creates/drops a database per file). Without the variable the suite runs on PGlite.

## Money-path behaviours covered (46 tests)

* Server-side pricing ignores client input; unavailable items and invalid option selections rejected; order-create idempotent.
* **Not paid until verified:** polling never marks paid; no client "I paid" path; kitchen sees nothing before payment.
* Webhooks: unsigned, wrong-signature, stale-timestamp and tampered-body rejected; genuine accepted; replay harmless (one ledger charge); wrong amount never fulfilled.
* **Lost webhook** recovered by status enquiry and by reconciliation.
* Failure states: bank decline, 3DS fail, cancel, expiry (sweeper), **late capture after expiry honoured**.
* **Fallback:** LankaQR outage → unavailable + card; method switched off → hidden; acquirer stub → `not_configured`.
* **Duplicate payment:** second capture → `paid_duplicate`, auto-refunded, order untouched; DB index forbids a second `paid`.
* Refunds: partial → full, idempotent replay, over-refund blocked, role-gated, key + reason required, ledger sums.
* Reconciliation: heals, settles, flags `paid_locally_not_at_provider`.
* Security: RLS read/write isolation, cross-tenant API attempts 404, per-order tracking tokens, CSRF header, role matrix, login lockout & uniform error, suspension takes effect immediately, pending approval gate, rate limits, append-only ledger/audit, credentials encrypted and never returned, sandbox can't go live, marketplace gated, no PAN-capable columns.

## Gaps to close before launch (not yet automated)

* **Provider contract tests** — replay the acquirer's and PayHere's own sandbox test matrices in CI once credentials exist.
* Load test (k6): order creation + webhook burst, SSE fan-out to ~500 connections.
* Concurrency test: parallel duplicate webhooks + sweeper against the same payment on multi-connection Postgres (logic is row-locked; PGlite is single-connection so it cannot prove this).
* Accessibility audit (axe in Playwright) and a screen-reader pass of the payment screen in all three languages.
* Real-device matrix: low-end Android (Chrome, Samsung Internet), iOS Safari, in-app browsers (QR scanners often open links in a webview).
* Restore-from-backup drill; DAST scan (ZAP) against staging.
