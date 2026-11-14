# Deployment

Three environments, same artefacts: **development** (sandbox on, embedded or local Postgres), **staging** (real Postgres, sandbox on, provider *sandbox* credentials), **production** (`ALLOW_SANDBOX=false`).

## Configuration (API)

| Var | Required | |
|---|---|---|
| `NODE_ENV` | | `production` enforces the rules below |
| `DATABASE_URL` | prod | Postgres 13+. Embedded PGlite is refused in production |
| `JWT_SECRET` | prod | ≥ 32 chars |
| `SECRETS_KEY` | prod | base64 of 32 bytes; encrypts provider credentials. **Back it up** — without it stored credentials are unrecoverable |
| `PUBLIC_URL` | | public origin; QR codes and provider return/notify URLs are built from it |
| `ALLOW_SANDBOX` | | defaults `true` outside production, `false` in production |
| `COOKIE_SECURE` | | defaults `true` in production |
| `UPLOAD_DIR` | | menu photos; **use a persistent volume or move to object storage** |
| `PORT` / `HOST` / `LOG_LEVEL` | | |

Web: `API_INTERNAL_URL` (build-time rewrite target, dev only — in production Caddy routes `/api/*`).

## Option A — single VM with Docker Compose (small café SaaS)

```bash
cp infra/.env.example infra/.env        # set DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, SECRETS_KEY
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```
Caddy obtains TLS automatically, sends `/api/*` to the API (SSE unbuffered) and everything else to Next.js. Migrations run at API start. The Compose/Dockerfiles were **not built in the authoring sandbox** (no Docker daemon) — build them in CI before relying on them.

## Option B — managed services

* **Postgres:** managed instance with PITR backups (e.g. a Sri Lanka/Singapore-region provider). Create two roles: a *migration owner*, and a runtime login role `GRANT tf_app TO runtime_role` that is **not** superuser and not the table owner.
* **API:** any container host, **1 replica** until the event bus is swapped for LISTEN/NOTIFY/Redis. Health check `GET /api/health`.
* **Web:** any Node host or container; or Vercel/Netlify with `/api/*` rewritten to the API.
* **Edge:** TLS 1.2+, HSTS, request-size limit ~1 MB, WAF if available. Webhook paths (`/api/webhooks/*`) must be reachable from the provider; if the provider publishes source IPs, allow-list them *in addition to* (never instead of) signature verification.

## Release flow

`main` → CI (typecheck, API tests on Postgres 16 **and** PGlite, build, `npm audit`) → deploy to **staging** → run `node scripts/e2e.mjs` against staging → manual approval → production. Migrations are forward-only and additive; deploy API before web when a release adds endpoints.

## Operations

* **Backups:** daily full + WAL/PITR; test a restore monthly. The ledger and audit log are legal records.
* **Monitoring:** alert on API 5xx rate, `payments.status='created'` older than 2 min (provider calls stuck), webhook `signature_ok=false` bursts, sweeper errors, payment failure rate (admin overview shows 7-day rate), and any row with `needs_refund`.
* **Logs:** pino JSON, cookies/authorization redacted. Never log webhook bodies in full or any credential.
* **Secrets rotation:** rotate `JWT_SECRET` (signs everyone out); rotating `SECRETS_KEY` requires re-encrypting `secret_enc` (script not included).
