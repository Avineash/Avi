# VOCO StaffHub

Workforce management (leave, rosters, notifications) with a **white-label, multi-tenant design system**.
Every company, and optionally every property, controls its own visual identity from an in-app
**Brand & Appearance** screen: no code changes, no redeploy.

> The branding layer is deliberately not VOCO-specific. `@staffhub/theme-core` and `@staffhub/ui`
> know nothing about leave or hotels, and can theme any product.

## Quick start

```bash
npm install
npm run dev          # API on :8787, web on http://localhost:5173 (seeded demo data)
npm test             # 86 tests: theme engine, tenant isolation, versioning, a11y gate, design-system guard
npm run build && npm start   # production: API serves the built web app on http://localhost:8787
```

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`). Data lives in `data/staffhub.db`;
`npm run seed` recreates the demo data.

### Demo accounts (password `staffhub-demo`)

Three fictional companies, each with a different published theme. The sign-in page lists them,
and `/login?company=aurora` brands the page for that company before anyone signs in.

| Company | Theme | Try |
|---|---|---|
| Aurora Hotels Group | Premium hospitality · 2 properties, Alpine Lodge overrides the primary colour | `admin@aurora.example` (company admin), `alpine.admin@aurora.example` (property admin) |
| Maison Verde Collection | Boutique hotel | `admin@maison-verde.example` |
| Meridian Suites | Luxury dark, with a dark-mode logo | `admin@meridian.example` |

Per property: `<property>.admin@<company>.example`, `<property>.<department>.manager@<company>.example`.
Employees are listed on the sign-in page.

## What's in the box

| Requirement | Where |
|---|---|
| Brand identity (names, logo, favicon, colours, nav, buttons + states, fonts, radius, density, light/dark/system) | `theme-core/schema.ts`, Brand & Appearance → Identity / Colors / Type & shape |
| Brand & Appearance manager: logo uploader, palette editor, preset gallery, live desktop + mobile × light + dark previews, Save / Reset / Publish | `apps/web/src/brand/` |
| Six editable presets (premium hospitality, modern corporate, minimal monochrome, boutique hotel, luxury dark, custom brand) | `theme-core/presets.ts` |
| Company → property → department, inherited branding, permissioned overrides, strict tenant isolation | `apps/server/src/{brand/store,tenancy}.ts`, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Status colours (green / amber / red / grey) independent of brand, always icon + label, WCAG 2.2 AA validation with warnings | `theme-core/a11y.ts`, Status + Accessibility tabs |
| CSS custom properties, central config, DB storage by company/property, inheritance, version history, preview, publish, rollback | `theme-core/css.ts`, `brand/store.ts` |
| Every screen, calendar, chart, notification and roster reads tokens only | `packages/ui`, enforced by `tokens-only.test.ts` |

## Layout

```
packages/theme-core   framework-agnostic engine: schema, validation, presets, inheritance, derivation, WCAG audit, CSS
packages/ui           React components driven only by --ds-* tokens (container-query responsive)
apps/server           Hono + node:sqlite API: auth, tenant-scoped data, versioned brand store
apps/web              React + Vite app and the Brand & Appearance manager
docs/                 architecture, security notes, extension guide
```

## Using the design system in another product

```ts
import { resolveTheme, themeToCss } from '@staffhub/theme-core';
const theme = resolveTheme(companyLayer, propertyLayer);   // merge + derive every token
document.head.append(Object.assign(document.createElement('style'), { textContent: themeToCss(theme) }));
document.documentElement.dataset.scheme = 'system';        // 'light' | 'dark' | 'system'
```

Then style anything with `var(--ds-primary)`, `var(--ds-surface)`, `var(--ds-status-approved-bg)`, … or use `@staffhub/ui`.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#4-using-the-design-system-elsewhere).
