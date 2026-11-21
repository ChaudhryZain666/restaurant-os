# GarnishTable — Fixes for the November 2026 Browser QA Findings

Branch `fix/full-browser-qa-findings`, from `main` `12d7238`. Nothing here is merged, pushed or deployed. Production is still `4ffc99b`.

- Original findings: [`full-browser-qa-audit.md`](full-browser-qa-audit.md).
- Every-route check after the fixes: [`full-browser-all-pages-verification.md`](full-browser-all-pages-verification.md).

**How this was verified.** Unit and API tests, then a real browser (Chromium via Playwright) on an isolated local stack: the `restaurant_platform_e2e` database, mock billing, payment and geocoding providers, and seeded demo accounts only. Checks ran at 1440px and 390px, on direct load, refresh and in-app navigation, and recorded console errors and failed requests. A second storefront ran without `VITE_RESTAURANT_SLUG` and with `VITE_SITE_URL` set to itself, to reproduce `order.garnishtable.com`. Browser evidence is in the run logs listed at the end.

## Status

| ID | Sev | Finding | Status |
|---|---|---|---|
| QA-001 | P2 | Signed-out promo code → "Missing access token" | **FIXED** |
| QA-002 | P2 | Item dialog shows base price after a paid option | **FIXED** |
| QA-003 | P3 | Admin pages request `/restaurants/null/…` on direct load | **FIXED** |
| QA-004 | P3 | Staff/kitchen request plan entitlements on every page (403) | **FIXED** (client); server rule unchanged — decision D-2 |
| QA-005 | P3 | Blank restaurant name → only "Validation failed" | **FIXED** |
| QA-006 | P3 | Platform admin can open the owner Support page (400) | **FIXED** |
| QA-007 | P3 | Another customer's order shows bare "Forbidden" | **FIXED** |
| QA-008 | P3 | Printed receipt logo broken | **FIXED** |
| QA-009 | P3 | `order.garnishtable.com/` unbranded "R / Restaurant" page | **FIXED** |
| QA-010 | P3 | Draft homepage public at `/v2` | **FIXED** |
| QA-011 | P3 | Marketing unknown page returns HTTP 200 | **FIXED** — verified on a real nginx 1.27.4 with the production templates on 15 Nov ([final-release-readiness.md](final-release-readiness.md)) |
| QA-012 | P3 | 401 console error on every signed-out page load | **FIXED** |
| QA-013 | P3 | Generic storefront titles, no description, cart lacks h1 | **FIXED** |
| QA-014 | P3 | Mobile: cramped support table; awkward reset-password message | **FIXED** |
| D-1 | — | Marketing promises Stripe card checkout that isn't live | **FIXED** (wording); launching Stripe is separate work — see below |
| NEW-1 | P2 | A cancelled page load can sign the user out everywhere | **FIXED 15 Nov** — session families + atomic refresh; see [final-release-readiness.md](final-release-readiness.md) |
| NEW-2 | P3 | Owners could open the platform support queue page (no data exposed) | **FIXED** |
| NEW-3 | P3 | Staff role changes save instantly and aren't audited | **FIXED 15 Nov** — confirmation + `staff.role_changed` audit entry |

## Findings

### QA-001 — signed-out promo code (P2)
- **Root cause:** `POST /restaurants/:id/promotions/check` sat behind the router-wide `requireAuth` + staff permission. The cart offers promo codes before sign-in, so every signed-out customer got a 401.
- **Fix:** the check route now sits above the auth middleware, with its own rate limit (30 a minute per IP), so guessing codes stays slow. The check is read-only: it never counts a use. The code is checked again on the server when the order is placed, and placing an order still needs an account. Creating, listing, editing and deleting promotions still need staff permission.
- **Files:** `apps/api/src/routes/promotion.routes.ts`.
- **Tests:** `promotion.controller.test.ts` (+5). A signed-out check gives the same discount as a signed-in one and returns only public fields. Unknown, expired, inactive, used-up and under-minimum codes get a reason, never "token". A code from another restaurant is refused. A malformed restaurant id returns `valid:false`. Managing promotions still returns 401 signed out and 403 for a customer. 20/20.
- **Browser:** signed out at 1440 and 390. A bad code shows "Invalid promo code". `QAFIX10` applies −$1.45 on $14.50. The cart survives a refresh. "Place order" sends the customer to `/login`. No 401s, no console errors.

### QA-002 — item dialog price (P2)
- **Root cause:** the Cinematic dialog's button printed `item.price`, while the cart priced base + options. Each side worked out the price on its own.
- **Fix:** one shared rule, `linePrice()` and `selectionsToModifiers()`, used by the dialog button, `MenuPage` and the cart subtotal. The server still re-prices every order from its own menu.
- **Files:** `apps/web/src/lib/itemPrice.ts` (new), `theme/cinematic/MenuSection.tsx`, `pages/MenuPage.tsx`, `context/CartContext.tsx`.
- **Tests:** `itemPrice.test.ts` (6): base price, one option, several add-ons, quantity, stale option ignored, dialog equals cart line.
- **Browser:** Margherita button $12.50 → $14.50 after choosing Medium, and the cart shows $14.50, at desktop and mobile.

### QA-003 — `/restaurants/null` requests (P3)
- **Root cause:** on a direct load, `LocationContext` first resolves for "no user yet" (`loading=false`, location `null`). When the signed-in user arrives, there is one render before its effect runs again, with `loading` still false and the location still null. Pages mount in that render and request `/restaurants/null/…`.
  - The first attempt only gated `Layout` on `loading`. The browser check showed this was **not enough**: owner, manager, staff and kitchen still sent null requests. The real fix is below.
- **Fix:** the context records which user and business it last resolved for. It reports `loading` until that matches the current user and business. `Layout` shows a spinner while loading, then mounts the page keyed to the location.
- **Files:** `apps/admin/src/context/LocationContext.tsx`, `apps/admin/src/components/Layout.tsx`.
- **Tests:** new Playwright spec `e2e/full-browser-qa-fixes.spec.ts`, "QA-003": direct load and refresh of `/menu`, `/settings`, `/orders` and `/customers` make no null request.
- **Browser:** owner (4 pages), manager (4), staff (2), kitchen (2), each loaded directly and refreshed. Zero `/restaurants/null` requests.

### QA-004 — entitlement 403s for staff/kitchen (P3)
- **Root cause:** `useBusinessEntitlements` asked `/businesses/:id/subscription/entitlements` for every signed-in user. The server lets only `billing.read` roles read it, so staff and kitchen got a 403 on every page.
- **Fix:** the hook only asks when the user can read billing (`useCan("billing.read")`). Otherwise it uses the default entitlements, as it already did when no business existed.
- **Server rule:** unchanged. Letting staff read plan entitlements was blocked as a security change and is left to you — decision **D-2**. Today nothing staff see depends on plan limits.
- **Files:** `apps/admin/src/hooks/useBusinessEntitlements.ts`.
- **Browser:** staff and kitchen sent 0 entitlement requests, with no 403s across direct loads and refreshes.

### QA-005 — "Validation failed" on a blank name (P3)
- **Root cause:**
  - The API's schema check answers with the generic message "Validation failed" and puts the field details in `details`. Every app showed only the generic message.
  - The name rule `z.string().min(2)` did not trim, so `"   "` passed.
- **Fix:**
  - The schema trims names and gives clear messages.
  - The shared API client turns "Validation failed" into the first field's message, so every form benefits.
  - Settings checks the name before saving. The message appears under the field, the field gets `aria-invalid`, Settings switches to the General tab, and other unsaved edits are kept.
  - A refusal from the server is also shown on the field.
- **Files:** `packages/validation/src/restaurant.ts`, `packages/utils/src/apiClient.ts`, `apps/admin/src/lib/restaurantName.ts` (new), `apps/admin/src/pages/SettingsPage.tsx`, `apps/admin/jest.config.js` (maps `@restaurant/validation` for the test).
- **Tests:** `restaurantName.test.ts` (5): blank and whitespace refused, client and server agree on every case, the server's field message reaches the user, other errors pass through unchanged.
- **Browser:**
  - Blank and whitespace-only names: "Enter a restaurant name." under the field, `aria-invalid="true"`, the description edit kept, no request sent.
  - A forced server refusal shows "Restaurant name must be at least 2 characters" on the field and in the alert.
  - The server still returns 400 and leaves the name unchanged.
  - A valid save still says "Saved."

### QA-006 — platform admin on the owner Support page (P3)
- **Root cause:** `/support` and `/support/:id` are scoped to a location. A platform admin has no location open, so the page requested `/restaurants/null/support/tickets`.
- **Fix:** with no location open, a platform admin is redirected to `/platform/support` or `/platform/support/tickets/:id`. A platform admin running its own restaurant, and every restaurant role, keep the restaurant page.
- **Files:** `apps/admin/src/lib/roleHome.ts`, `apps/admin/src/App.tsx`.
- **Tests:** `roleHome.test.ts` (4); Playwright "QA-006".
- **Browser:** the admin is redirected on both URLs with no null request, and Back works. The owner still sees the restaurant Support page.

### QA-007 — another customer's order (P3)
- **Root cause:** the order page displayed the API's raw error message ("Forbidden").
- **Fix:** 403, 404 and 400 all show the same "Order unavailable" page. It says "We couldn't find that order on your account…" and links to My orders, so the page never confirms that someone else's order exists. A 401 asks the customer to sign in. Anything else shows a retry message. The receipt page uses the same messages. The API's ownership check is unchanged.
- **Files:** `apps/web/src/lib/orderLoadError.ts` (new), `pages/OrderDetailPage.tsx`, `pages/PrintReceiptPage.tsx`.
- **Tests:** `orderLoadError.test.ts` (3); Playwright "QA-007".
- **Browser:** signed in as Priya:
  - Jordan's order, a non-existent id and a malformed id all show the same message.
  - Nothing says "Forbidden" and Jordan isn't named.
  - The My orders link works.

### QA-008 — receipt logo (P3)
- **Root cause:** the demo seed points the logo at `/restaurant-images/wildwood-kitchen-logo.svg`. Each app serves its own `public/`, and that file (and the `.jpg` cover) existed only in the storefront's folder, so the admin print page got a 404.
- **Fix:** both files added to `apps/admin/public/restaurant-images/`. A test now keeps the two apps' demo images in step.
- **Note:** uploaded logos are absolute URLs and were never affected.
- **Files:** `apps/admin/public/restaurant-images/wildwood-kitchen-logo.svg`, `demo-restaurant-cover.jpg`.
- **Tests:** `demoAssets.test.ts` (3). Checked to fail when the file is removed.
- **Browser:** `/print/receipt/:id` logo loaded, with no 404.

### QA-009 — unbranded storefront root (P3)
- **Root cause:**
  - With no restaurant, every theme header falls back to "R / Restaurant".
  - The root with no slug showed one line of muted text.
- **Fix:**
  - On the platform's own storefront host only (`VITE_SITE_URL`), a page with no restaurant uses plain Classic chrome named "GarnishTable": the root, an unknown slug, sign-in and so on.
  - Any other host may be a restaurant's or agency's white-label domain, so it keeps the neutral placeholder. Restaurant pages never show platform branding.
  - The root now explains itself: "Open your restaurant's ordering link". It offers Sign in or My orders, and "I run a restaurant" (marketing site) on the platform host.
- **Files:** `apps/web/src/lib/platformHost.ts`, `components/Layout.tsx`, `pages/NoRestaurantPage.tsx` (new), `App.tsx`, `theme/types.ts`, `theme/classic/Header.tsx`, `theme/classic/Footer.tsx`.
- **Tests:** `platformHost.brand.test.ts` (4): platform host branded; restaurant page, custom domain and agency domain never branded.
- **Browser:** on the platform host at 1440 and 390:
  - The root and an unknown slug are GarnishTable-branded.
  - The Wildwood page shows only Wildwood.
  - "Sign in" works.
  - A non-platform host keeps the neutral chrome.

### QA-010 — `/v2` draft public (P3)
- **Fix:** the draft route and its lazy import exist only in the dev server. A production build answers `/v2` with the noindex 404 page, and the draft code isn't in the bundle.
- **Files:** `apps/marketing/src/App.tsx`.
- **Tests:** `apps/marketing/routes.test.mjs`: `/v2` is dev-only, not served with 200 and not in the sitemap.
- **Browser:** production build (`vite preview`) at 1440 and 390: `/v2` shows "We couldn't find that page", `noindex, nofollow`, with no console errors. No `HomeV2` chunk is in `dist/`.

### QA-011 — soft 404 on marketing (P3)
- **Fix:** `marketing.locations.template` lists the site's real pages, served with 200. Any other path that isn't a file still gets the app shell, which renders the 404 page, but with a **404 status** (`try_files $uri =404; error_page 404 /index.html`). `/assets/` and `/api/` keep their own locations.
- **Files:** `infrastructure/docker/nginx/marketing.locations.template`, `apps/marketing/routes.test.mjs`, `apps/marketing/package.json` (test script).
- **Tests:** `routes.test.mjs` (4):
  - Every public route in `App.tsx` is in the 200 list, and nothing extra.
  - `/v2` isn't in it.
  - The catch-all answers with a 404.
- **Not verified:** the config was not run against a real nginx. Docker Desktop can't start its Linux engine here, because WSL isn't installed.
- **Next step:** build the marketing image (`APP=marketing`, `frontend.prod.Dockerfile`) on any Docker host and check these return 200: `/`, `/pricing`, `/terms`, `/robots.txt`, `/sitemap.xml`, `/og-image.png`, `/v3/logo-mark.png`, `/assets/*`. Then check that `/no-such-page` and `/v2` return 404 with the app shell. The `deploy-rehearsal`/`edge-e2e` scripts are the natural place.

### QA-012 — 401 refresh error for signed-out visitors (P3)
- **Root cause:** every app calls `POST /auth/refresh` on load to restore a session. With no refresh cookie, the API answered 401, which the browser logs as a console error on every signed-out page.
- **Fix:**
  - The API answers **204 No Content** when there is **no refresh cookie at all**. That means no session, and no tokens and no cookie are set.
  - A cookie that is sent but invalid, expired or revoked still gets 401, and reuse detection is unchanged.
  - The shared client treats 204 as "signed out".
- **Files:** `apps/api/src/controllers/auth.controller.ts`, `packages/utils/src/apiClient.ts`.
- **Tests:**
  - `auth.controller.test.ts` (+3): no cookie gives 204 with no body or cookie; a malformed cookie gives 401; a valid cookie rotates, and reusing it gives 401. 25/25.
  - `apiClient.test.ts` (4): 204 means signed out; 401 still fails; a success stores the token; a 401 with no session ends the session.
- **Browser:** signed-out storefront at 1440 and 390, admin login and marketing home. Refresh answers 204, with no console errors.
- **Deploy note:** ship the API and the frontends together, as one release. An older frontend talking to the new API won't parse the 204 body, which is harmless on load but logs an error.

### QA-013 — storefront titles and headings (P3)
- **Fix:**
  - A title and description for every storefront page that doesn't set its own, for example "Cart · Wildwood Kitchen", "Sign in", "My orders" and "Help center". Menu pages keep their SEO titles.
  - The empty cart, and the cart for a different restaurant, keep a (visually hidden) "Cart" h1.
  - The HTML shell defaults to "Order online" with a description.
- **Files:** `apps/web/src/lib/pageTitles.ts` (new), `components/Layout.tsx`, `pages/CartPage.tsx`, `index.html`.
- **Tests:** `pageTitles.test.ts` (3).
- **Browser:** cart title, description and h1 at both widths; `/login`, `/register`, `/support`, `/forgot-password` and `/orders` titles.

### QA-014 — mobile layout (P3)
- **Root cause:**
  - The platform support table (7 columns) had no scroll container, so at 390px each cell squeezed to one word per line.
  - `Alert` is a flex row, so the reset-password sentence and its link became separate flex items and wrapped apart.
  - The Users, Customers and Restaurants tables already scroll inside their cards. That is unchanged and works.
- **Fix:**
  - The support table keeps a 760px minimum width inside its own `overflow-x-auto` box, with cell padding.
  - The reset-password message is one paragraph, in both the admin and storefront apps.
- **Files:** `apps/admin/src/pages/SupportDashboardPage.tsx`, `apps/admin/src/pages/ResetPasswordPage.tsx`, `apps/web/src/pages/ResetPasswordPage.tsx`.
- **Tests:** Playwright "QA-014" (2).
- **Browser:** at 390px the table is 760px wide inside a scroll box, with no sideways page scroll. Both reset-password messages are one sentence and the link works.

## D-1 — Stripe card payments vs. the marketing site

**What exists in the code (test mode only):**
- Stripe Connect with Standard accounts and Stripe-hosted onboarding (Account Links). No restaurant API keys are collected.
- Direct charges on the connected account, signed webhooks (`STRIPE_CONNECT_WEBHOOK_SECRET`), and refunds with idempotency and reconciliation.
- Files: `apps/api/src/payments/stripeConnect.ts`, `StripeProvider.ts`, `restaurantProvider.ts`.
- There is also an older "bring your own keys" path.

**What production runs:**
- The launch checklist (`docs/production-launch-checklist.md` §3) treats launch as **cash only** with `PAYMENT_PROVIDER=mock`.
- The live demo store offers only "Cash · Pay in person".
- I couldn't read the production environment (blocked), so this comes from the checklist, the live page and earlier notes, not from the server.
- **So online card payments are not operational in production.**

**Changed (wording only, no payment code):**
- Home: "Checked out on your own Stripe account, with a promo code applied." is now "Checked out in a few taps, with a promo code applied."
- Pricing note: now "Customers pay you directly. Online card payments through your own Stripe account are coming soon — Stripe's standard processing fee will apply."
- FAQ "How do I get paid?": now "Today, customers pay you directly — in person at pickup, on delivery or at the table. Online card payments through your own Stripe account are coming soon…"
- The same corrections in the dev-only `/v2` draft.
- The owner Settings timezone note was wrongly badged "Coming soon" although it describes current behaviour. It is now a plain note.

**To launch Stripe card payments** (each step is yours, or needs your approval):
1. Activate the Stripe account for live payments. That needs business verification and bank details.
2. Enable Connect for Standard accounts and set the platform branding in Stripe.
3. Set in production: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`. `PAYMENT_ELIGIBILITY_ROUTING` stays false unless you also use Safepay.
4. Register two webhook endpoints, the platform one and the Connect one. Include the refund events listed in the launch checklist.
5. In test mode first: run one restaurant through onboarding, pay, refund and reconcile.
6. Then put the marketing wording back to present tense.

None of this was done. No account was connected, no keys were created, and no production or payment configuration was changed.

## New issues found during verification

### NEW-1 (P2, pre-existing) — a cancelled page load can sign the user out everywhere
> **Update, 15 Nov:** fixed on `fix/final-release-readiness`. See [final-release-readiness.md](final-release-readiness.md). The analysis below is kept as found.

- **Seen:** while re-testing every page, signed-in roles (customer, agency) were repeatedly bounced to `/login` after quick Back/Forward and reload sequences.
- **Reproduced on its own:** customer signed in, then repeatedly start a storefront page load and leave it as soon as its `/auth/refresh` request is sent.
  - On the 6th attempt the next refresh returned **401** and the customer was signed out.
  - Script: `probe-fastnav.cjs`; result `{"lostAt":6,"refreshStatuses":[200,200,200,200,200,200,200,401]}`.
- **Why:**
  - Each full page load calls `/auth/refresh`, which rotates the single-use refresh token.
  - If the browser abandons that request after the server has rotated the token, the new cookie is never stored.
  - The next load sends the old token. Reuse detection (`auth.controller.ts`, `revokeAllRefreshTokens`) treats that as theft and **revokes every session for that user**.
- **Real-world trigger:** reloading twice quickly, or tapping a link while a page is still starting. The result is being signed out on every device.
- **Unrelated to these fixes:** this path only runs when a refresh cookie is present, and that path was not changed.
- **Not fixed because** it is a change to session security. The usual remedy is a short grace window, where an old token presented within a few seconds of rotation gets the same new session instead of a full revocation. That should be your decision.
- **Interim:** none needed for correctness. Users just sign in again.

### NEW-2 (P3, pre-existing) — **FIXED** — owners could open the platform support queue
- **Seen:** the every-route check found a restaurant owner could open `/platform/support` and `/platform/support/tickets/:id`.
- **Root cause:** those routes were gated on `support.tickets.read`, which owners and managers also hold.
- **No data was exposed.** The API refuses them, because the support-admin router requires the `platform_admin` role: owner → `GET /support/admin/tickets` gives 403. Separately, a real Spice Route ticket opened by the Wildwood owner gives 403, its messages give 403, and it isn't in Wildwood's list.
- **Fix:** both routes are now role-gated to `platform_admin`, matching the API. Owners are sent back with the usual "You don't have access" toast, and their own `/support` page is unchanged.
- **Files:** `apps/admin/src/App.tsx`.
- **Tests:** Playwright "NEW-2" in `e2e/full-browser-qa-fixes.spec.ts`.
- **Browser:** the owner is redirected away from both URLs, and the platform admin still has both.

### NEW-3 (P3, pre-existing) — staff role changes are instant and unaudited
> **Update, 15 Nov:** fixed. There's a confirmation, and a `staff.role_changed` audit entry is visible to owners and managers only.

- **What happens:** on Staff, changing a member's role saves the moment the dropdown changes. There's no confirmation, and no audit-log entry, because `staff.controller.ts` `updateStaff` records nothing.
- **Found by accident:** my own page-sweep script changed the dropdowns, and the seeded kitchen and staff accounts became managers in the local test database. I then reset the database and reran everything.
- **Suggested fix** (needs your approval):
  - record `staff.role_changed` and `staff.locations_changed` audit entries;
  - consider a confirm step or an explicit Save for role changes.
- Authorisation itself is correct: only owners and managers of the same restaurant can change roles, and location ids are checked against the business.

### Other observations (not defects)
- **Kitchen staff can open Customers.** _(Update, 15 Nov: restricted. Kitchen no longer has the directory; see final-release-readiness.md.)_ The customer list (names, contact details, spend) is gated on `restaurant.orders.read`, so kitchen staff can see it. This is deliberate and documented in `customer.routes.ts`, but you may want it limited to managers. Decision D-3.
- **`GET /restaurants/by-domain/localhost` 404:** the local storefront without `VITE_SITE_URL` logs this once per load. Production sets `VITE_SITE_URL`, which skips the lookup (Phase 88). Environment only.
- **The demo playground signs the visitor in:** opening the storefront demo (`/r/:slug/experience`) and choosing "Order online" signs the visitor in as a temporary "Demo Guest" customer for the whole storefront. That is by design (Phase 32), but a visitor may not expect it.

## Decisions for you
- **NEW-1:** add a short grace window to refresh-token rotation, or keep strict reuse detection.
- **NEW-3:** audit-log staff role changes and add a confirm step.
- **D-3:** should kitchen staff see the customer list?
- **D-1 (above):** keep the "coming soon" wording until Stripe is live, or choose different wording.
- **D-2 (QA-004):** should staff and kitchen be allowed to read plan entitlements? The client no longer asks, so the 403s are gone without changing the server. Allowing it would need a server permission change, which I did not make.
- **QA-011:** run the nginx check above on a Docker host before deploying.

## Updated stale browser tests
- `e2e/admin-audit-log.spec.ts`: the seeded demo's add-to-cart flow differs by theme. The step now works with both, as `delivery.spec.ts` already does, and still chooses a size and places the order.
- `e2e/agency-portal-2.spec.ts`: the domain panel's wording changed from "does not do yet" to "What it doesn't do:". The assertion targets the new wording and still checks the limitation is stated.

## Tests, builds, lint (final runs, 15 Nov 2026)

| Check | Result |
|---|---|
| API Jest (`apps/api`, `restaurant_platform_test`) | **162/162 suites, 2230/2230 tests pass**. An earlier run made while the machine was also seeding and starting servers had 14 timeouts in 5 suites; those 5 suites reran alone with 94/94 passing, and the final full run passed. |
| Admin Jest | 9/9 suites, 44/44 |
| Storefront Jest | 10/10 suites, 49/49 |
| `packages/utils` Jest | 2/2 suites, 12/12 |
| Marketing `node --test` | 11/11 |
| Typecheck | `tsc -b` admin ✓, web ✓; `tsc --noEmit` API ✓ |
| Lint | 0 errors in admin, web, marketing and API. Warnings are pre-existing (admin 21, web 14, API 11); none are in a changed file. |
| Production builds | packages, web, admin, marketing, API: all succeed |
| Playwright regression batch (19 specs, 55 tests) | **54 passed, 1 failed**. `admin-audit-log` was bounced to `/login` straight after sign-up. Rerun alone it passed 2/2 (3/3 counting earlier runs), so it's intermittent and consistent with NEW-1. |
| New Playwright spec `full-browser-qa-fixes.spec.ts` | 7/7 (QA-003, QA-006, NEW-2, QA-007, QA-014 ×2) |
| Browser fix checks (`verify-fixes.cjs`) | **60/60** on a freshly seeded database |
| Every route (`routes-all.cjs`) | **109/109 PASS**. See the verification document and its Limits section. |
| Journey re-runs (customer, delivery, owner, platform admin, agency) | Same results as the 8 Nov audit, except that the promo step which failed in the audit (QA-001) now passes. The remaining failing steps are the audit scripts' own selector issues, the same steps as on 8 Nov, and those flows pass in the Playwright specs above. |

**The four main journeys still work.**
- **Customer order:** `full-order-flow`, `demo-restaurant-menu-ordering`.
- **Delivery checkout:** `geocoding-delivery`, `delivery`.
- **Owner management:** `menu-builder-manual-journey`, `business-hours-settings-save`, `payment-settings-and-loyalty`.
- **Platform admin and agency:** `platform-admin-routing`, `agency-portal-2`, and the admin/agency journey script, 37/37 steps.

**Evidence** is in [`evidence/fixes/`](evidence/fixes/): result files, logs, screenshots and the scripts used.
