# Customer journey & wireframes

Screens are implemented in `apps/web`; screenshots are produced by `scripts/e2e.mjs` / `scripts/tour.mjs` (`SHOTS=dir`).

```
1 SCAN            2 MENU                3 ITEM SHEET          4 CHECKOUT (one page)
┌───────────┐     ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ table QR  │ →   │ ▓ Brand hero ▓ │ →  │  large photo   │ →  │ lines  − 1 +   │
│ /t/<tok>  │     │ 📍Table T1     │    │ Name  Rs 1,450 │    │ Subtotal       │
│ no app    │     │ [Mains][Hop..] │    │ ◉ Mild ○ Hot   │    │ Service 10 %   │
└───────────┘     │ 🔥 Popular ▸▸  │    │ ☐ Extra egg +  │    │ VAT 18 %       │
                  │ ▢ item  [img]+ │    │ notes…         │    │ Total          │
                  │ ═ View order ═ │    │ [−1+][Add Rs.] │    │ ◉ LankaQR ★rec │
                  └────────────────┘    └────────────────┘    │ ○ Card         │
                                                              │ [ Pay Rs 1,882 ]│
                                                              └────────────────┘
5a LANKAQR                       5b CARD                       6 TRACK
┌────────────────┐               ┌────────────────┐            ┌────────────────┐
│ Amount Rs …    │               │ Redirect to    │            │ ✔ Paid         │
│ ┌────────────┐ │               │ provider-hosted│            │ We have order  │
│ │  dynamic   │ │               │ page (3DS) ──▶ │ ───────▶   │ ①──②──③──④     │
│ │   QR       │ │               │ card data never│            │ Recv Prep Rdy… │
│ └────────────┘ │               │ touches us     │            │ 🧾 receipt  ★★★ │
│ expires 04:59  │               └────────────────┘            └────────────────┘
│ ● waiting…     │
│ steps 1-2-3    │   Same phone? [Open banking app ↗]   Unavailable? → banner + card pre-selected
└────────────────┘
```

**Journey rules:** menu opens with one request · cart persists per table in `localStorage` · prices always from the server · one idempotency key per cart · payment page never says "paid" until the server does · language switch (EN/සිං/தமிழ்) and light/dark available on every customer screen.

## Staff screens

* **Kitchen** (`/kitchen`, dark, tablet/TV friendly): three columns New / Preparing / Ready; each ticket shows order #, table, items × qty, options, notes (highlighted), **PAID · method**, minutes since payment (amber ≥10, red ≥20), one big action button. Audible chime (Web Audio, enabled by one tap to satisfy browser autoplay rules); live/polling indicator.
* **Dashboard** (`/dashboard/*`): overview (KPIs, daily chart, LankaQR-vs-card split, top items) · live orders · menu editor (trilingual, photo upload, option groups, instant sold-out toggle) · tables + QR (view/rotate/print A4 cards) · payments (list, refund, ledger, reconciliation, methods) · feedback · staff · settings & branding with live customer preview · support.
* **Admin** (`/admin/*`): overview + revenue · restaurants (approve/reject/suspend, provider configuration, go-live checklist) · transactions & failed payments & webhook log · plans · support inbox · audit log · CSV exports.

## Design system

Tokens are CSS variables (`globals.css`): surfaces, ink, muted, status colours, brand/brand-2 per restaurant. `brandVars()` derives an **AA-contrast text colour** and on-brand colour from whatever primary the restaurant picks. Light/dark via `data-theme` (follows the phone by default). Tap targets ≥ 44 px, visible focus rings, `aria-live` for payment states, `prefers-reduced-motion` honoured. Charts use the validated categorical slots 1–2 (blue/orange), thin marks with 2 px gaps, legend + hover tooltip + "view as table".
