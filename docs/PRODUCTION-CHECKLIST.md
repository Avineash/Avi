# Production readiness checklist

☐ = not done in this prototype. ✅ = built and tested here.

## Payments & compliance (blockers for real money)
- ☐ Merchant agreement + KYC with an acquiring bank / PSP for **each** method; written confirmation of: dynamic-QR API availability, refund support, settlement timing, fee schedule, **whether split settlement is permitted** (needed only for marketplace model).
- ☐ Implement `lankaqr_acquirer` against the bank's sandbox (QR create / notify signature / status enquiry / refund / settlement report). Until then LankaQR stays unavailable and customers use cards (✅ verified behaviour).
- ☐ Verify the **PayHere** adapter in PayHere's sandbox (hash, notify `md5sig`, status codes, return/cancel URLs, domain whitelisting); add refund + retrieval via their OAuth API if required.
- ☐ PCI DSS: confirm **SAQ A** eligibility (hosted checkout only — ✅ no card fields, columns or endpoints exist). Keep the CSP `form-action` allow-list to the provider domains.
- ☐ Check obligations with a Sri Lankan lawyer/accountant: Central Bank of Sri Lanka payment-service licensing relevance of the chosen settlement model, VAT/SSCL treatment of service charges, e-receipt requirements, PDPA (Personal Data Protection Act No. 9 of 2022) duties.
- ☐ Provider test matrix passed and recorded for each restaurant before `go-live` (✅ checklist enforced in the admin UI + API).
- ✅ Sandbox providers cannot be switched live; ✅ `ALLOW_SANDBOX=false` removes them from the registry.

## Security
- ✅ Tenant isolation (app scope + RLS), ✅ verified webhooks, ✅ idempotency, ✅ audit log, ✅ encrypted provider secrets, ✅ rate limiting, ✅ CSRF header, ✅ lockout.
- ☐ Runtime DB role is non-superuser, member of `tf_app`; migration role separate.
- ☐ Move `JWT_SECRET` / `SECRETS_KEY` to a secret manager; document rotation (re-encryption script).
- ☐ Upgrade **Next.js to ≥ 16.4** (clears the PostCSS advisories `npm audit` reports for Next 15's bundled copy — build-time only, but fix before launch) and re-run the tour/e2e. Add Dependabot/Renovate.
- ☐ MFA for owners and platform admins; password-breach check; session revocation list.
- ☐ Penetration test; DAST in CI; WAF; bot protection on `/orders` (e.g. Turnstile) — a malicious scanner can currently create unpaid orders (capped 8 open/table/10 min, expired after 30 min).
- ☐ Move uploads to object storage with malware scanning and image re-encoding.

## Reliability
- ☐ Replace in-process event bus with LISTEN/NOTIFY or Redis before >1 API replica.
- ☐ Run the sweeper as a single leader (advisory lock) when scaling out.
- ☐ Managed Postgres with PITR; restore drill; alerting per `DEPLOYMENT.md`.
- ☐ Provider timeouts/retries tuned from real latency; circuit-breaker thresholds reviewed.
- ☐ Outbox worker for receipts (✅ rows are written; ☐ email/SMS/WhatsApp delivery is simulated).

## Data & privacy
- ☐ Retention job: anonymise `customer_name/phone/email` after N days (suggest 90) while keeping financial records 7 years; document in the privacy notice.
- ☐ Data-subject export/delete procedure.
- ✅ Customer details optional; ✅ no card data stored.

## Product & localisation
- ☐ **Native-speaker review of all Sinhala and Tamil strings** (UI + seed menu) and font rendering check on low-end Android.
- ☐ Real food photography per restaurant (current art is generated placeholder).
- ☐ Receipts: confirm required legal fields (tax registration, invoice numbering) — current receipt is explicitly *not* a tax invoice in sandbox.
- ☐ Replace illustrative plan prices / fee bps / VAT & service-charge defaults with real figures.
- ☐ Onboarding assistance flow for non-technical café owners (guided menu import, QR print kit).

## Operations
- ☐ Staging environment with provider sandboxes; CI deploy pipeline; release approval.
- ☐ Runbooks: provider outage, webhook flood/forgery, duplicate-payment refund backlog, suspending a restaurant, lost `SECRETS_KEY`.
- ☐ Support SLAs and an on-call rota for payment incidents.
