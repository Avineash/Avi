# Architecture

## 1. Principles

1. **Brand is data, not code.** Everything a tenant can change is a JSON *theme layer* stored in the database.
2. **One token vocabulary.** Components read `--ds-*` CSS custom properties and nothing else. A test fails the build if a
   component hard-codes a colour (`packages/ui/src/tokens-only.test.ts`).
3. **Layers, not forks.** A theme is `system default → company → property`. A layer is *sparse*: it states only what it changes.
4. **Branding can never touch business data.** Theme tables have no foreign keys into leave/roster/employee tables
   and the theme code paths never write to them. A test hashes every business table before and after publish / restore / reset
   and asserts they are identical.
5. **Accessible by construction.** Derived colours are guaranteed readable; user-chosen colours are audited; leave statuses
   are gated hard.

```
 admin edits ──► draft (sparse layer, revisioned) ──publish──► immutable version N ──► active pointer
                   │                                   ▲                                   │
   live preview ◄──┘ (client-side, isolated scope)     └── rollback = new version copying an old one
                                                                                           ▼
 any user ──► GET /api/me|/api/theme ──► merge(default, company@active, propertyName, property@active) ──► CSS variables
```

## 2. The theme model (`packages/theme-core`)

### Layers and inheritance
`resolveTheme(...layers)` deep-merges the system default and the given layers left to right (`null` is a value: "no logo";
absent means "inherit"). A property layer is merged over the company's *published* layer, so company drafts never leak and
future company publishes flow to every property that has not overridden that setting.

Two identity defaults come from records, not themes: the company name (from `companies.name`) and the property name
(from `properties.name`), so a brand-new tenant is correctly named before anyone opens the editor.

### Tokens
Seeds an administrator sets (per light/dark scheme): `primary, secondary, accent, pageBg, surface, text, sidebarBg, sidebarText`.
Derived unless overridden: `mutedText, border, inputBorder, sidebarActive, buttonBg, buttonText, buttonHoverBg, buttonActiveBg, focusRing`.
Always derived: `primaryText` (brand colour nudged to ≥ 4.5:1 for links), `onSecondary`, `onAccent`, six `chart` colours (each ≥ 3:1 on cards),
a **neutral** `info` tone (deliberately not brand-coloured, so it can never be mistaken for a status), shadows.
Independent of brand: `status.{approved,pending,rejected,cancelled}.{light,dark}.{bg,fg}`.
Also: `typography.{headingFont,bodyFont}` (approved library only), `shape.radius` (5 steps), `shape.density` (3 steps), `mode.default`, `mode.allowUserOverride`.

`themeToCss()` emits `:root{…light + shape/type}`, `:root[data-scheme="dark"]{…}` and a `prefers-color-scheme` rule for
`data-scheme="system"`. Pass a different selector to scope a theme to a subtree, which is how previews coexist with the live theme.

### Delegation to properties
The company scope stores an **override policy**: which groups (`identity, colors, status, typography, shape, mode`) property
administrators may change. Default: identity only. Company administrators are never restricted.
The policy is enforced on every write by a property administrator (draft save, publish, rollback, asset upload).
Tightening a policy does not erase overrides a property already published; a company admin resets those from the property screen.

## 3. Server

### Tenancy and permissions

Hierarchy: **Company → Property → Department**. Departments are an organisational unit used by rosters and approvals; they
share their property's theme (per-department theming is intentionally out of scope).

| Role | Brand & Appearance | Leave / roster visibility |
|---|---|---|
| company_admin | every scope of their company, override policy, audit log | whole company |
| property_admin | their own property, only groups the policy allows | their property |
| manager | none | their department; may approve within it |
| employee | none (sees the published theme) | themselves; department roster |

**How isolation is enforced**
- The tenant comes from the *session* (`requireAuth` → `Ctx`), never from a request parameter.
- Query predicates are built by `tenancy.ts` and always start with `company_id = ?`; point lookups include the predicate too
  (`WHERE id = ? AND <scope>`), so another tenant's row is indistinguishable from a missing row: **404, not 403**.
- Scope URLs (`/api/brand/scope/:scope`) are resolved against the caller's company (`resolveScope`).
- A draft may only reference image assets uploaded by the same company.
- Tests (`apps/server/src/test/api.test.ts`) log in as every role of every company and assert every returned row belongs to the
  caller's company; they attempt cross-tenant read/approve/cancel/brand/asset access.

**PostgreSQL / defence in depth.** SQLite has no row-level security. On Postgres, add `company_id` RLS policies keyed to
`current_setting('app.company_id')`, set per request by the same middleware:
```sql
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON leave_requests USING (company_id = current_setting('app.company_id')::uuid);
```

### Versioning
- `theme_scopes`: one row per company / property: draft JSON, draft `revision`, `active_version`, override policy.
- `theme_versions`: immutable rows (`version`, `config`, `kind = publish | rollback`, `restored_from`, `note`, author, whether accessibility failures were acknowledged).
- **Draft** saves require the current `baseRevision` (409 if another admin changed it). **Publish** requires the revision the admin previewed
  and re-validates policy, assets and accessibility server-side.
- **Rollback** never rewrites history: it publishes a *new* version copying an old one, so "restore" is itself restorable.
- Every publish, rollback, policy change and upload is in `audit_log`.

### Accessibility gate
`auditTheme()` runs in the editor on every change and again on the server at publish:
- **Blocking, no override:** leave-status text/background below 4.5:1 (people read leave by colour at a glance).
- **Needs explicit acknowledgement (recorded on the version):** any other AA failure: body/secondary text, button label in
  default/hover/pressed, nav text, field borders and focus ring (3:1).
- **Warnings:** a status drifting from its conventional colour (approved ≠ green…), two statuses that look alike (ΔE < 10).
- **Notes:** where the engine adjusted a brand colour to make it readable as text.
- Statuses always render an icon *and* a text label (`StatusBadge`); there is no setting to turn that off (WCAG 1.4.1).

### Security notes
- Theme JSON is validated strictly (unknown keys rejected; colours must be `#rrggbb`; fonts and enums come from fixed lists; names have no markup).
  Nothing free-text ever reaches generated CSS.
- Uploads: type is sniffed from bytes, size-capped, SVG is rejected if it contains script, event handlers, `foreignObject`, external references or entities.
  Assets are served with `nosniff` and `Content-Security-Policy: sandbox`, and only ever used via `<img>`.
  Asset ids are random UUIDs; the sign-in page needs them before authentication, so reads are public by id.
- Sessions: random token, only its SHA-256 stored, `HttpOnly; SameSite=Lax` cookie, `Secure` behind HTTPS (`COOKIE_SECURE=1` or `X-Forwarded-Proto`).
  Every state-changing request needs `X-Requested-With: staffhub`. Login is throttled.
- Passwords are scrypt-hashed. **Demo seed users share one password; replace the auth layer (SSO/OIDC) before production use.**

### API (all under `/api`, JSON)
| | |
|---|---|
| `POST /auth/login · /auth/logout` · `GET /me` · `PATCH /me/preferences` | session, current user + published theme |
| `GET /theme` · `GET /public/brand?company=&property=` | published theme (ETag); public one is for the sign-in page |
| `GET /brand/scopes` · `GET /brand/scope/:scope` | scopes you can manage; editor state (draft, live, inherited layers, policy) |
| `PUT /brand/scope/:scope/draft` · `DELETE …/draft` | save / discard draft |
| `POST …/publish` · `POST …/rollback` · `GET …/versions[/:n]` | publish, restore, history |
| `PUT /brand/policy` · `GET /brand/audit` | override policy, activity |
| `POST /brand/assets?kind=logo\|logoDark\|favicon` · `GET /assets/:id` | image upload / serve |
| `GET/POST /leave`, `POST /leave/:id/decision\|cancel`, `GET /roster`, `GET /notifications`, `GET /dashboard`, `GET /employees` | business data |

`:scope` is `company` or a property id.

## 4. Using the design system elsewhere

1. Depend on `@staffhub/theme-core` (no dependencies; runs in Node and browsers) and, for React, `@staffhub/ui`.
2. Store one sparse layer per tenant (and optionally per sub-brand). Resolve with `resolveTheme(...layers)`.
3. Inject `themeToCss(theme)` into the page; set `data-scheme` on `<html>`.
4. Style with tokens. To show two themes at once (previews, galleries) use `themeToCss(theme, { selector: '[data-x="1"]' })`
   or the `<ThemeScope>` component.
5. Gate publishing with `auditTheme(theme)`; use `applyFixes()` for one-click corrections.

**Add a token:** add it to `commonTokens`/`schemeTokens` in `css.ts`, derive it in `resolve.ts`, read it in a stylesheet.
The guard test fails if a component reads a variable that isn't emitted.
**Add a font:** add it to `FONT_LIBRARY` and import its Fontsource CSS in `apps/web/src/fonts.ts`.
**Add a preset:** add an entry to `PRESETS`; the suite fails it if it doesn't pass AA.
**Add an override group:** extend `CONFIG_GROUPS`, `GROUP_LABELS` and the validator; policy enforcement follows automatically.

## 5. Decisions and limits (read before going live)

- **Auth is demo-grade** (local users, shared seed password). Wire in SSO and real user management.
- **SQLite + images in the database** keep the project self-contained. For scale: Postgres (+RLS above) and object storage/CDN for images.
- **Theme changes appear on next load or when a tab regains focus** (ETag revalidation); there is no websocket push.
- **A logo with no dark-mode variant is shown on a light plate in dark mode.** Provide a dark logo for the best result.
- **Presets are original examples.** They imitate no real brand and claim no official compliance; upload only logos you are licensed to use.
- **Not covered by automated contrast checks:** disabled controls (exempt in WCAG), text over user-uploaded images, and the content of the logo itself.
- Orphaned uploaded images are not garbage-collected.
- Dates are handled as UTC calendar days; time-zone-aware rostering is out of scope.
