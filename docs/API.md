# API reference

Base path `/api`. JSON in/out. Errors: `{ "error": "<code>", "message": "…", …extra }`.
Auth for staff: httpOnly cookie `tf_session` (set by `/auth/login`) **plus** header `x-tf-csrf: 1` on non-GET requests; or `Authorization: Bearer <jwt>`.
Money fields are integer cents (`…Cents`) unless the name says otherwise. `Idempotency-Key` header: 8–80 chars.
Rate limits: global 300/min/IP; login 10/min; order create 12/min; payment create 20/min; registration 5/10 min.

## Customer (no account — capability tokens)

| Method & path | Purpose |
|---|---|
| `GET /public/t/:tableToken` | Restaurant branding + table + **full menu** (items, option groups, availability). `404 table_not_found` if QR inactive / restaurant suspended |
| `GET /public/t/:tableToken/methods` | Payment methods for checkout: `[{method, available, reason?, recommended, sandbox, capabilities}]`. Unconfigured methods are omitted |
| `POST /public/t/:tableToken/quote` | `{items:[{itemId, qty, optionIds[], note?}]}` → server-priced `{subtotal, service, tax, total, lines[]}` |
| `POST /public/t/:tableToken/orders` | **`Idempotency-Key` required.** `{items, customer:{name?,phone?,email?}, lang, notes?}` → `{orderId, trackingToken, number, totalCents}`. `422 unavailable / option_rules / unknown_item`, `429 too_many_open_orders` |
| `GET /public/orders/:id?t=<trackingToken>` | Order, items, totals, status, payment summary (also the receipt data) |
| `GET /public/orders/:id/methods?t=` | Same as table methods, for re-pay / switch method |
| `POST /public/orders/:id/payments?t=` | `{method:'lankaqr'\|'card'}` (optional `Idempotency-Key`) → payment view: `{id,status,amountCents,expiresAt,qrSvg?,qrPayload?,deepLink?,redirect?{url,method,fields?},sandbox}`. `409 method_unavailable {reason, fallback:'card'}`, `503 provider_error {fallback}` |
| `GET /public/payments/:paymentId?t=` | Current payment view. Triggers a throttled **server-side status enquiry** |
| `POST /public/orders/:id/feedback?t=` | `{rating 1-5, comment?}` once order is ready/served |
| `GET /public/orders/:id/stream?t=` | **SSE**: `payment.updated`, `order.updated` |

## Webhooks (provider → TableFlow)

`POST /webhooks/:providerKey` — body is verified over the **raw bytes** per provider (HMAC-SHA256 `x-sandbox-signature: t=<ts>,v1=<hex>` for sandbox; `md5sig` for PayHere). `200 {ok, duplicate}`; `401 invalid_webhook` for anything unverifiable (logged in `payment_events`). Replays are idempotent.

## Auth

| | |
|---|---|
| `POST /auth/login` `{email,password}` | sets cookie; `401 invalid_credentials`, `429 locked`, `403 pending_approval / restaurant_inactive` |
| `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` | |
| `POST /auth/register-restaurant` | self-service onboarding → restaurant `pending` |

## Restaurant (staff) `/r/*` — tenant-scoped, permission in brackets

| Path | |
|---|---|
| `GET /r/orders?view=active\|pending\|history` [orders:read] | |
| `POST /r/orders/:id/status` `{status}` [orders:update] | enforces Received→Preparing→Ready→Served (one step; one step back allowed); requires paid order |
| `GET /r/stream` [orders:read] | **SSE**: `order.paid`, `order.status`, `payment.duplicate` |
| `GET/POST /r/tables`, `PATCH /r/tables/:id`, `POST /r/tables/:id/rotate-token`, `GET /r/tables/:id/qr.svg` [tables:write for writes] | plan table-limit enforced (`402 plan_limit`) |
| `GET /r/menu`; `POST/PATCH/DELETE /r/categories[/:id]`; `POST /r/items`, `PUT /r/items/:id`, `PATCH /r/items/:id/availability`, `DELETE /r/items/:id` [menu:write] | items carry `optionGroups[]` (replaced wholesale on PUT) |
| `POST /r/uploads` (multipart `file`) [menu:write] → `{url}` | |
| `GET/PATCH /r/settings` [orders:read / settings:write] | name, tax, service charge, branding |
| `GET /r/payment-config`, `PATCH /r/payment-config/:method {enabled}` [payments:read / settings:write] | |
| `GET /r/payments`, `GET /r/payments/:id/refunds` [payments:read] | |
| `POST /r/payments/:id/refund` `{amountCents?, reason, manual?}` + **`Idempotency-Key`** [refunds:create] | |
| `GET /r/ledger?from&to&format=csv` [payments:read] | |
| `POST /r/reconcile` `{provider,from,to}`, `GET /r/reconciliations` [refunds:create / payments:read] | |
| `GET /r/reports/sales?from&to` [reports:read] | totals, daily, by method, top items, ratings |
| `GET /r/feedback`, `GET/POST/PATCH /r/staff[/:id]` [staff:manage], `GET/POST /r/tickets…`, `GET /r/audit` | |

## Platform `/admin/*` — `platform_admin` (write) / `platform_support` (read + tickets)

`GET /admin/overview` · `GET/POST /admin/restaurants` · `POST /admin/restaurants/:id/{approve,reject,suspend,reinstate}` · `PATCH …/plan` · `GET /admin/providers` · `GET /admin/restaurants/:id/payment-configs` · `PUT …/payment-configs/:method` · `POST …/payment-configs/:method/go-live` (checklist) · `GET/PUT /admin/plans[/:id]` · `GET /admin/transactions?failed=true&method=&status=` · `GET /admin/webhook-events` · `GET /admin/tickets`, `POST /admin/tickets/:id/messages` · `GET /admin/export/{transactions,failed,revenue,restaurants}` (CSV) · `GET /admin/audit` · sandbox only: `POST /admin/sandbox/outage`, `POST /admin/sandbox/settle`.

## Sandbox endpoints (only when `ALLOW_SANDBOX=true`)

`GET /sandbox/txn/:ref`, `POST /sandbox/lankaqr/:ref/authorise`, `GET /sandbox/cards`, `POST /sandbox/card/:ref/complete` — the simulated bank / hosted card page. They call the real webhook route with a real signature.
