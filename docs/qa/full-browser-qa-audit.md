# GarnishTable — Full Browser QA Audit

**Date:** 8 November 2026 · **Auditor:** Claude (browser automation, Playwright/Chromium) · **Mode:** audit only — no application code changed, nothing committed, merged or deployed.

## 1. Executive summary

GarnishTable works end to end. Across both what's live in production and the newer merged code, I found **no P0 or P1 defects**:

- A customer can browse a menu, customise items, manage the cart, sign up and place an order.
- An owner can sign in, manage the menu, settings, orders and staff.
- A platform admin can create a restaurant, invite its owner and manage its plan without checkout.
- An agency can sign up, create clients and is isolated from other agencies.

All **17 access-control probes** were correctly refused, and no page overflowed horizontally at any of the five screen sizes.

What needs attention:

1. **Signed-out customers can't use promo codes**, and the cart shows the raw error **"Missing access token"** (QA-001, P2, production).
2. **The item dialog shows the base price** ("Add to order — $16.00") after a paid option is chosen; the cart then correctly charges $18.00 (QA-002, P2, production).
3. **Card payment promise vs production.** Marketing promises card checkout on "your own Stripe account". The live demo storefront offers **cash only**, and my records say production's order-payment provider is still `mock`. A decision for you (D-1), not a confirmed bug.
4. **Wasted failing requests on direct visits.** Most restaurant admin pages, opened directly or refreshed, first request data for restaurant `null` and get 403 before loading normally (QA-003, P3).
5. **Unpolished edges:**
   - an unbranded page at `order.garnishtable.com/`;
   - a public draft homepage at `/v2`;
   - a generic "Validation failed" message;
   - "Forbidden" shown to customers;
   - a broken logo on printed receipts;
   - console noise.

**Coverage:** 109 routes discovered. 63 were genuinely exercised (55 PASS, 8 FAIL); 44 are NOT TESTED (29 of them rendered cleanly at every size but weren't interacted with); 1 is BLOCKED (plus 6 blocked activities that aren't routes); 1 is not applicable. Section 7 lists every route.

## 2. Version and environment tested

| Environment | Version | What ran there |
|---|---|---|
| **Production**: `garnishtable.com`, `order.garnishtable.com`, `app.`, `admin.`, `agency.`, `pos.garnishtable.com`, `api.garnishtable.com` | `4ffc99b` (each app's `/version.json` and API `/health`) | Public pages only, **read-only**. No sign-in, no form submissions, no orders, no emails. The storefront cart was filled browser-side only; Place order was never clicked. |
| **Local QA stack** | `main` @ `12d7238` | Every signed-in journey and everything that changes data. Isolated local database `restaurant_platform_e2e`, reset and seeded like CI. Billing, payments, POS terminal and menu extraction were all mock; geocoding used an offline test provider; email went to the console provider, so nothing was sent. |

- **Marketing and storefront:** identical in `4ffc99b` and `12d7238` (`git diff` shows no changes). Production results for them therefore also hold for `main`.
- **Admin app and API:** differ only in the PR #22/#23 billing and platform-subscription work.
- **Browser:** Chromium (Playwright 1.62) at 1440×900, 1280×800, 768×1024, 390×844 and 360×800.

## 3. Applications and domains

| App | Production host(s) | Routes |
|---|---|---|
| Marketing site | `garnishtable.com` (`www.` alias) | 16 |
| Customer storefront | `order.garnishtable.com` (plus custom domains, not live yet) | 26 |
| Admin app (owner, staff, platform admin, agency, POS) | `app.`, `admin.`, `agency.`, `pos.garnishtable.com` (same app) | 67 |
| API | `api.garnishtable.com` | — |

**Roles:**
- platform_admin, restaurant_owner, restaurant_manager, restaurant_staff, kitchen_staff;
- agency owner/admin/staff (agency members);
- customer, and anonymous visitors.

**Integrations:**
- Lemon Squeezy (platform billing; production on `mock`);
- Stripe Connect and Safepay (order payments);
- Uber Eats, DoorDash, foodpanda (marketplaces);
- Uber Direct (courier);
- LocationIQ (geocoding);
- SMTP email;
- Claude (menu import).

## 4–6. Totals

| | Routes |
|---|---|
| Discovered | **109** (16 marketing + 26 storefront + 67 admin) |
| PASS | **55** |
| FAIL (reproducible defect on that route) | **8** |
| BLOCKED | **1** route (`/marketplace/oauth-callback`), plus 6 blocked activities listed under Section 7 |
| NOT TESTED | **44** (29 of them opened and rendered cleanly at every size, but not interacted with) |
| NOT APPLICABLE | **1** |

A route counts as PASS only if its main interactions were exercised: in this audit's own scripts, or by a browser spec that passed against the same build (named in the register).

## 7. Coverage register

Abbreviations:
- **R5** = rendered at all 5 sizes with no page errors and no horizontal overflow;
- **Prod** = tested in production read-only;
- **Local** = tested on the local `12d7238` stack;
- **e2e** = a project browser spec that passed against `12d7238` locally or in CI on 7–8 Nov (spec named).

### Marketing (production, `4ffc99b`)

| Route | Status | What was exercised |
|---|---|---|
| `/` | PASS | R5. All CTAs and nav links resolve (31/31 links return 200). Pricing teaser, demo anchor, FAQ accordions. Title and meta present. |
| `/product` | PASS | R5, content, links |
| `/how-it-works` | PASS | R5, content |
| `/solutions` | PASS | R5, content |
| `/pricing` | PASS | R5. Prices verified: $59/$590, $99/$990, $179/$1,790. 14-day no-card trial wording. FAQ. |
| `/demo` | PASS | R5. The live demo link opens the production demo storefront. |
| `/about` | PASS | R5 |
| `/contact` | PASS | R5. An empty submit is blocked (3 required fields flagged). **A real submission was not sent**, because it would email the team. |
| `/faq` | PASS | R5, accordions |
| `/start-trial` | PASS | R5. Owner and agency CTAs go to `app.garnishtable.com/signup` and `/start`. |
| `/privacy`, `/terms`, `/refund-policy` | PASS (3 routes) | R5. `legalConfigured: true`. |
| `/v2` | FAIL | QA-010: a draft homepage is publicly reachable |
| `/v3` | PASS | Redirects to `/` |
| `*` (unknown page) | FAIL | QA-011: friendly page, but HTTP 200 |

### Storefront (production read-only + local)

| Route | Status | What was exercised |
|---|---|---|
| `/r/:slug` | FAIL | **Prod + Local:**<br>- R5, categories (7, scroll to section);<br>- required option enforced;<br>- add to cart.<br>**Defect:** QA-002 (dialog price). |
| `/r/:slug/cart` | FAIL | **Prod + Local:**<br>- totals checked: lines, subtotal, change quantity, remove line;<br>- pickup/delivery switch;<br>- sign-in required to order;<br>- cart kept across sign-up;<br>- empty state.<br>**Defect:** QA-001 (promo). |
| Delivery checkout (inside cart) | PASS | e2e `geocoding-delivery.spec` 9/9 (local): address search, out-of-radius refusal, fee, promo on delivery, mobile, isolation between restaurants |
| `/r/:slug/t/:tableToken` | PASS | e2e `dine-in.spec` (4) |
| `/r/:slug/preview`, `/r/:slug/experience`, `/r/:slug/loyalty` | NOT TESTED | — |
| `/register` | PASS | Local: an empty and an invalid submit are blocked; a valid one creates the account |
| `/login` | PASS | Prod R5. Local sign-in. |
| `/forgot-password`, `/reset-password`, `/verify-email` | NOT TESTED | Prod R5 only |
| `/confirm-email-change`, `/account` | PASS | e2e `account-security.spec` (3): password change, email change, account deletion |
| `/orders` | PASS | Local: history and Back/Forward. e2e `order-history-pagination`. |
| `/orders/:id` | FAIL | Local: confirmation, order number, status survives refresh; another customer is refused.<br>**Defect:** QA-007 ("Forbidden" text). |
| `/orders/:id/receipt` | PASS | e2e golden path (receipt prints) |
| `/support`, `/support/articles/:slug`, `/support/tickets`, `/support/tickets/new`, `/support/tickets/:id` | NOT TESTED | `/support` Prod R5 only |
| `/`, `/cart`, `/t/:tableToken`, `/loyalty` (legacy) | `/` FAIL; the other 3 NOT TESTED | QA-009 (unbranded page at the bare domain) |
| `*` / unknown slug | PASS | Friendly "We can't find that restaurant" (header generic, part of QA-009) |

### Admin app — public and auth (production + local)

| Route | Status | What was exercised |
|---|---|---|
| `/login` | PASS | Prod R5.<br>Local:<br>- a wrong password gets "Invalid email or password";<br>- sign-in;<br>- **logout, after which protected pages and the Back button go to `/login`**. |
| `/register` | PASS | Local: agency owner sign-up, terms checkbox |
| `/signup` | PASS | e2e `owner-self-serve-signup`, `owner-self-serve-launch-journey` |
| `/start` | NOT TESTED | Prod R5 (agency plan chooser) |
| `/accept-invite` | PASS | e2e onboarding journeys. Prod: a missing token shows a clear error. |
| `/forgot-password`, `/reset-password` | PASS | e2e `owner-password-recovery`. Prod R5. Minor layout issue: QA-014. |
| `/verify-email`, `/accept-agency-invite`, `/force-password-change` | NOT TESTED | Rendered only |
| `/mock-checkout/:token` | N/A | Development-only mock billing |

### Admin app — restaurant owner and staff (local `12d7238`)

All rendered as R5 for the owner. Access was checked for manager, staff and kitchen: pages they can't use redirect them to their own home page.

| Route | Status | What was exercised |
|---|---|---|
| `/` (dashboard) | PASS | Sign-in lands here: KPIs, attention list, recent orders. Staff are sent to `/orders`, kitchen to `/kitchen`. |
| `/setup` | PASS | e2e golden path: readiness and publish |
| `/menu` | PASS | Local:<br>- an empty category is refused, then a category is added;<br>- "Create item" stays disabled without a name or with a negative price;<br>- the price field rejects text.<br>e2e `menu-builder-manual-journey` (create item, modifiers). QA-003 applies. |
| `/menu/import`, `/menu/import/job/:jobId` | PASS | CI e2e: menu import from PDF, photos and URL (12d7238 CI) |
| `/menu/import/csv` | NOT TESTED | R5 |
| `/orders` | PASS | Local: list (status columns, search, filters). Status changes Mark ready → Complete. e2e `order-cancellation`, `full-order-flow`. |
| `/kitchen` | PASS | e2e `kitchen-realtime`, golden path (accept → preparing → ready → complete, print ticket) |
| `/customers` | PASS | Local: list with lifetime stats |
| `/analytics` | PASS | Local: KPIs, trend chart |
| `/business-analytics`, `/business-promotions`, `/promotions`, `/loyalty` | PASS | e2e `business-analytics-and-promotions`, `payment-settings-and-loyalty`. Local: the promotion form opens. |
| `/delivery` | PASS | Local: pickup/delivery toggles, fee, radius map. "Live ETA — Coming soon" is labelled honestly. |
| `/marketplace` | PASS | Uber Eats, DoorDash and foodpanda each show "Not connected" and "Connect". e2e `marketplace-uber-eats-connect`. The connect flows themselves: BLOCKED (D-3). |
| `/tables` | PASS | e2e `dine-in` |
| `/staff` | PASS | Local: the browser's own check stops an invite to an invalid email; a valid invite appears in the list. Role selects. e2e `staff-invite-accept`. |
| `/settings` | FAIL | Local: business hours save and persist. A blank name is refused, but with the vague message of **QA-005**. Payment and Domain tabs reviewed (Stripe connect; custom domains "don't serve customers yet"). |
| `/billing` | PASS | Local: no-plan state with plan choice. e2e onboarding (managed plan, no checkout or cancel buttons). |
| `/audit-log` | PASS | Local: entries and filters render. The project's own spec for this page is out of date (wrong button label). |
| `/print/:mode/:id` | FAIL | e2e golden path prints a ticket and receipt. **QA-008:** broken logo image on the receipt. |
| `/locations`, `/theme-studio`, `/printers`, `/support`, `/support/:id`, `/print/preview/:jobId` | NOT TESTED | R5 (except the routes with IDs) |
| `/pos`, `/pos/tables`, `/pos/customers`, `/pos/orders`, `/pos/pending` | NOT TESTED | R5. The demo location's POS is disabled. The project has POS specs, but they weren't run in this audit. |
| `/marketplace/oauth-callback` | BLOCKED | Needs a real Uber OAuth round trip |

### Admin app — platform admin (local `12d7238`)

| Route | Status | What was exercised |
|---|---|---|
| `/platform` | PASS | Landing page after sign-in; KPIs |
| `/platform/restaurants` | PASS | Search filters 3 → 1. "Resend invite" says "Invitation resent to …". |
| `/platform/restaurants/new` | PASS | Refused correctly:<br>- empty form;<br>- invalid email;<br>- duplicate slug ("That restaurant slug is already taken");<br>- reused owner email (clear message).<br>A valid restaurant is created. |
| `/platform/restaurants/:id` | PASS | Full plan lifecycle, each step confirmed:<br>- offline plan at $45, with $0 blocked;<br>- extend;<br>- change plan;<br>- suspend and unsuspend;<br>- cancel at term end, then resume;<br>- cancel now;<br>- complimentary.<br>Billing history (18 rows) and audit entries are visible. |
| `/platform/subscriptions` | PASS | Billing-source column (Complimentary, Manual · offline). Revenue tiles. |
| `/platform/users`, `/platform/agencies`, `/platform/refunds`, `/platform/analytics`, `/platform/support`, `/platform/support/kb`, `/platform/settings` | NOT TESTED | R5. The agencies plan panel was covered by e2e on 7 Nov, not in this audit. |
| `/platform/support/tickets/:id` | NOT TESTED | — |

### Admin app — agency (local `12d7238`)

| Route | Status | What was exercised |
|---|---|---|
| `/agency` | PASS | Created 2 agencies through sign-up; dashboard shows role, subscription and clients |
| `/agency/businesses` | PASS | 4-step client wizard creates a client |
| `/agency/businesses/:businessId` | PASS | **Isolation:** agency 2 opening agency 1's client gets "Business not found" |
| `/agency/locations`, `/agency/members`, `/agency/billing`, `/agency/settings`, `/agency/activity` | NOT TESTED | R5 and content verified, not interacted with. e2e `agency-management`, `agency-provisioning-workspace`, `agency-post-lapse-reactivation`, `agency-entitlement-inheritance` passed on 7 Nov. |
| `/agency/locations/:locationId` | NOT TESTED | — |

**BLOCKED** — 1 route and 6 activities:
- `/marketplace/oauth-callback`;
- contact-form submission (would send email);
- production sign-in areas (no production credentials used, by your rules);
- Lemon Squeezy checkout (production billing is `mock`);
- Stripe and Safepay connect;
- Uber Direct connect;
- real email delivery.

## 8. Bugs, ranked by severity

No P0 or P1 found. Each issue lists where it reproduces, with evidence under `docs/qa/evidence/` (screenshots and raw JSON).

**QA-001 — P2 — A signed-out promo code shows "Missing access token" and can't be used**
- **Where:** Storefront, cart (`/r/demo-restaurant/cart`), as a signed-out customer. **Production and `main`.**
- **Steps:** add any item → open the cart → enter `WELCOME10` (or any code) → Apply.
- **Expected:** either the code applies, or the customer is told "Sign in to use a promo code".
- **Actual:** the red text "Missing access token". The network shows `POST /restaurants/:id/promotions/check` → 401. Reproduced in production at 3 sizes and locally.
- **Evidence:** `promo-missing-access-token.png`, `raw/prod-cart.json`.
- **Fix:** allow the promo check for guests (pricing is re-validated server-side at order time anyway), or catch 401 and show a sign-in prompt.

**QA-002 — P2 — The item dialog's Add button shows the base price after a priced option is chosen**
- **Where:** Storefront, item dialog (`/r/demo-restaurant`), customer. **Production and `main`**, all sizes.
- **Steps:** "Wild Mushroom & Taleggio Pizza" → choose "Medium (+$2.00)".
- **Expected:** the button reads "Add to order — $18.00".
- **Actual:** it stays at "$16.00". The cart then shows $18.00, so what's charged is correct, but the price shown at the moment of decision isn't.
- **Evidence:** `item-dialog-price.png`, `raw/prod-cart.json` (`dialogPriceBefore`/`AfterMedium`).
- **Fix:** derive the button label from base price + selected options × quantity.

**QA-003 — P3 — Most restaurant admin pages first request data for restaurant `null` (403)**
- **Where:** Admin app, restaurant pages for owner and manager. Examples: `/menu`, `/orders`, `/kitchen`, `/customers`, `/analytics`, `/promotions`, `/loyalty`, `/marketplace`, `/tables`, `/staff`, `/audit-log`, `/printers`, `/setup`, `/support`.
- **Steps:** sign in as an owner, then open any of these by URL or refresh it.
- **Expected:** one load, with no failing calls.
- **Actual:** `GET /api/v1/restaurants/null/...` returns 403 (1–3 calls per page). The page then loads normally once the active location resolves. It's console noise and wasted requests, and could flash an error on slow connections.
- **Affects:** `main` and very likely production (the page code is unchanged).
- **Evidence:** `raw/local-roles.json`.
- **Fix:** don't request until the active location ID is known (the Dashboard already does this).

**QA-004 — P3 — Staff and kitchen accounts request plan entitlements on every page (403)**
- **Where:** Admin app, every page as `restaurant_staff` or `kitchen_staff`.
- **Actual:** `GET /businesses/:id/subscription/entitlements` returns 403 on 39 and 45 pages respectively.
- **Note:** I saw no feature wrongly hidden from staff in this pass.
- **Evidence:** `raw/local-roles.json`.
- **Fix:** skip the call for roles without `billing.read`, or let staff read entitlements.

**QA-005 — P3 — Saving settings with a blank name says only "Validation failed"**
- **Where:** Admin app, `/settings` → General, as the owner.
- **Steps:** clear the Restaurant name → Save settings.
- **Expected:** "Restaurant name is required", next to the field.
- **Actual:** the generic "Validation failed" (it was correctly refused).
- **Evidence:** `settings-validation-failed.png`.

**QA-006 — P3 — A platform admin can open the owner Support page, which then errors**
- **Where:** Admin app, `/support`, as a platform admin.
- **Actual:** the page isn't redirected, and it calls `GET /restaurants/null/support/tickets` → 400.
- **Fix:** route platform admins to `/platform/support`.

**QA-007 — P3 — A customer opening someone else's order sees the bare word "Forbidden"**
- **Where:** Storefront, `/orders/:id` with another customer's order ID.
- **Note:** access is correctly refused (API 403).
- **Fix:** show "We couldn't find that order" with a link to My orders.

**QA-008 — P3 — The printed receipt logo is broken**
- **Where:** Admin app, `/print/receipt/:id`.
- **Actual:** the image `/restaurant-images/wildwood-kitchen-logo.svg` is requested from the admin app's own address, where it doesn't exist.
- **Not checked:** whether logos real owners upload (stored as absolute upload URLs) have the same problem.
- **Fix:** resolve logo URLs against the storefront or API origin.

**QA-009 — P3 — `order.garnishtable.com/` shows an unbranded "Restaurant" page**
- **Where:** production, the bare storefront domain (and the header on unknown-restaurant pages).
- **Actual:** a generic "R / Restaurant" header and "This link doesn't specify a restaurant".
- **Evidence:** `storefront-root-desktop.png`.
- **Fix:** redirect the bare domain to `garnishtable.com`, and use GarnishTable branding when no restaurant applies.

**QA-010 — P3 — A draft homepage is public at `garnishtable.com/v2`**
- A complete alternative homepage design is reachable; `/v3` redirects to `/`.
- **Evidence:** `marketing-v2-draft.png`.
- **Fix:** remove it, or noindex and redirect it.

**QA-011 — P3 — Marketing's "page not found" returns HTTP 200**
- A friendly page, but a soft 404 for search engines.
- **Fix:** serve a 404 status, for example a Caddy fallback with a 404 code for unknown paths.

**QA-012 — P3 — Every signed-out page load logs a console error**
- **Where:** production, all apps.
- **Actual:** `POST /api/v1/auth/refresh` → 401 on every signed-out page load.
- **Note:** an expected session-restore check, but it shows up as an error in the console.
- **Fix:** have the refresh endpoint return 204 when there's no session cookie, or skip it when there's no session hint.

**QA-013 — P3 — Storefront non-menu pages share one generic title, "Restaurant Ordering"**
- **Where:** production storefront: cart, login, register, forgot-password and support pages.
- **Actual:** no meta description, and the cart page has no `<h1>`.
- **Note:** a minor SEO and accessibility issue; these pages aren't indexed anyway.

**QA-014 — P3 — Mobile layout rough spots**
- **Platform support ticket table:** squeezed to roughly one word per line at 390px (`sheet-platform-mobile.png`).
- **Wide tables (Users, Customers, Restaurants):** these scroll sideways inside their own box, so columns start off-screen (the page itself doesn't overflow).
- **"Reset link is missing its token" message:** its inline link wraps awkwardly (`sheet-public-mobile.png`).

**Not product defects (recorded so they don't come back as false alarms):**
- Two project browser specs are out of date with the UI:
  - `admin-audit-log.spec.ts` expects the Cinematic theme's "Add to order" button;
  - `agency-portal-2.spec.ts` expects removed wording.
- The local dev API shares its database with Jest, so a full test run deletes the demo data (a test-environment issue).
- The offline test geocoder only knows a few fixture addresses.

## 9. Evidence

Everything is in `docs/qa/evidence/`:
- **Contact sheets:**
  - `sheet-marketing-desktop.png`, `sheet-public-mobile.png` — production public pages;
  - `sheet-owner-mobile-1.png`, `sheet-platform-mobile.png` — owner and platform pages at 390px.
- **Individual screenshots:** listed per bug above.
- **Raw results (`raw/*.json`):**
  - per-route data at every size: status, final URL, console errors, failed requests, overflow and offending elements, broken images, title/meta/h1;
  - every journey step with PASS/FAIL, what was observed, and a page snapshot for failures;
  - the API access-control probes.

Screenshots were taken at full page for desktop and at viewport height for mobile.

## 10. User journeys

| Journey | Where | Result |
|---|---|---|
| **Customer** (desktop and mobile): open storefront → categories → item with required option → choose size → add a second item → cart totals → change quantity → remove line → pickup/delivery → place order while signed out (asked to sign in) → register (invalid input blocked) → cart kept → **place order** → confirmation ORD-1007 → refresh → empty cart → order history → Back/Forward | Local | **Works.** Defects: QA-001, QA-002. Delivery covered by `geocoding-delivery.spec` 9/9. |
| Customer in production (read-only) | Prod | Works up to the cart. Place order was not clicked (by your rules). The cart offers **cash only** (D-1). |
| **Restaurant owner:** wrong password → sign in → dashboard → menu validation → category → settings validation → hours save/persist → order status changes → staff invite → promotions, analytics, customers, billing, audit, loyalty, delivery, marketplace, tables, theme, printers, locations | Local | **Works.** Defects: QA-003, QA-005. Item creation and modifiers via `menu-builder-manual-journey`; cancellation via `order-cancellation`. |
| Owner self-serve sign-up → launch | e2e | Works (`owner-self-serve-signup`, `owner-self-serve-launch-journey`). |
| **Platform admin:** sign in → **logout / Back button** → restaurant search → create-restaurant validation (empty, email, slug, owner email) → create → resend invite → full plan lifecycle → history and audit → subscriptions report | Local | **Works fully.** |
| Admin → owner onboarding → publish → customer order → kitchen complete | e2e `platform-admin-onboarding-subscription`, golden path | Works. |
| **Agency:** register → create agency → client wizard → all agency pages → **cross-agency isolation** | Local | **Works.** |
| Staff / kitchen | Local | Each lands on its own page (Orders / Kitchen). Restricted pages redirect. QA-004 noise. |

## 11. Mobile and responsive findings

- **Overflow:** no horizontal page overflow at 1440, 1280, 768, 390 or 360px on any of the 52 signed-in admin pages (6 roles) or the 40 production public pages.
- **Mobile navigation:** the hamburger menu works on marketing, storefront and admin.
- **Rough spots:** QA-014. The storefront and marketing look and read well on phones; minimum text size is fine on the storefront, while marketing uses some tiny uppercase "eyebrow" labels by design.
- **Not done:** an exhaustive check of every modal at tablet size.

## 12. Security and permission findings

**All 17 read-only API probes behaved correctly, and none leaked a stack trace:**
- anonymous → 401 for restaurant orders and platform routes;
- another restaurant's owner → 403 for that restaurant's orders, analytics, customers and subscription;
- owner → 403 for `/platform/*`, including the manual-plan endpoint;
- staff → 403 for analytics, the staff list and subscription cancel;
- customer → 403 for restaurant orders, and 403 for another customer's order (200 for their own; anonymous 401);
- agency 2 → 403 for agency 1's businesses and client subscription;
- an agency → 403 for an unrelated restaurant.

**In the browser:**
- after logout, protected pages and the Back button land on `/login`;
- signed-out production URLs (`/`, `/orders`, `/platform`, `/platform/restaurants`, `/agency`, `/billing`, `/settings`) all redirect to `/login`;
- the owner, manager, staff and kitchen access matrix matches each role (e.g. a manager can't reach Settings or Staff; staff can't reach Analytics);
- another restaurant's printed order links are refused.

**Messages:** error messages never exposed internals. The one raw technical string a user can see is QA-001 ("Missing access token").

**Not done:** this was not a penetration test. No injection, brute-force or session-fixation testing.

## 13. Integration status

| Integration | What the user sees | Status |
|---|---|---|
| Lemon Squeezy (platform billing) | Production billing is `mock`; the owner billing page offers plans, and checkout is closed in production | Implemented and test-mode verified on 7 Nov. **Waiting on store approval.** Not used in production. |
| Stripe Connect / Safepay (order payments) | Settings → Payment shows "Connect payment account" (Stripe), with Safepay as an alternative. The production demo storefront offers only "Cash · Pay in person". | **Unverified in production** (D-1) |
| Uber Eats | Marketplace page: "Not connected · Connect Uber Eats" | Sandbox store linked earlier. The end-to-end order isn't proven. Connect: BLOCKED. |
| DoorDash, foodpanda | "Not connected · Connect" | Written from the providers' docs; partner onboarding needed |
| Uber Direct | Delivery page: "Requires your own Uber Direct merchant account · Connect Uber Direct" | Not connected. Its local work-in-progress is untouched. |
| Custom domains | Settings → Domain: "Custom domains don't serve customers yet" | Intentionally not switched on |
| Live delivery ETA | "Coming soon" | Not built |
| Email | Console provider locally. Production SMTP **not exercised** (no emails sent). | NOT TESTED |

## 14. Incomplete or mocked features

- **Live delivery ETA:** "Coming soon".
- **Custom-domain hosting:** not switched on.
- **Platform billing:** production on mock until Lemon Squeezy approval.
- **Order card payments in production:** unverified (D-1).
- **Marketplaces and Uber Direct:** not live.
- **POS:** disabled for the demo location; not exercised in this audit.
- **Payment tab label:** a "Coming soon" label on the Settings → Payment tab sits near "Online payment"; what it refers to needs clarifying.

## 15. Recommended fixes, by priority

1. **QA-001:** fix the guest promo-code error — either allow guest checks or prompt sign-in.
2. **QA-002:** make the item-dialog button show the price including options.
3. **D-1:** resolve the card-payment promise vs production configuration (decision below).
4. **QA-003 and QA-004:** stop requests for restaurant `null`, and staff entitlement calls.
5. **QA-005, QA-006, QA-007, QA-008:** clearer validation and not-found messages, platform-admin Support routing, receipt logo URL.
6. **QA-009 to QA-014:** bare storefront domain, `/v2` draft, soft 404, refresh-probe noise, storefront titles, mobile tables.
7. **Test suite:** update the two out-of-date specs, and give the local dev API its own database.

## 16. Decisions for you

- **D-1 — Card payments.**
  - **The claim:** marketing repeatedly says orders are "checked out on your own Stripe account". My notes (6 Nov) say production's order-payment provider is still `mock`, and the live demo storefront offers only cash.
  - **Choose:** either confirm Stripe Connect is configured in production (I couldn't check; reading production is blocked for me), or soften the marketing wording until it is.
- **D-2 — The `/v2` draft homepage:** remove it, or keep it as a deliberate variant.
- **D-3 — Real provider flows:** Uber Eats, Uber Direct, Stripe and Lemon Squeezy connect flows, and real email delivery, can only be verified with provider accounts or a staging environment with real credentials. Do you want a staging environment for that?
- **D-4 — Production signed-in testing:** a read-only production pass of the owner and admin areas needs a test account you designate, used only for reading.
