# GarnishTable — Final Release Readiness (15 Nov 2026)

**Branch:** `fix/final-release-readiness`. Built on `fix/full-browser-qa-findings` (`5ab9ea4`), which was built on `main` (`12d7238`).

**Final commit:** in the commit message and in the hand-over. A file can't record its own commit hash.

**Nothing is pushed, merged or deployed.** Production is still on `4ffc99b`.

Earlier reports, all kept: [`full-browser-qa-audit.md`](full-browser-qa-audit.md), [`full-browser-qa-fixes.md`](full-browser-qa-fixes.md), [`full-browser-all-pages-verification.md`](full-browser-all-pages-verification.md).

## Summary

| Item | Result |
|---|---|
| NEW-1: an interrupted session refresh signed the user out everywhere | **Fixed** without weakening reuse detection. A second real flaw found and fixed on the way: concurrent refreshes could fork one token. |
| NEW-3: staff role changes | **Fixed**: confirmation step and audit entry |
| Kitchen access to the customer directory | **Restricted** on the server. Kitchen keeps its orders. |
| QA-004: plan entitlements | **Secure**. The server rule is unchanged, now covered by tests. |
| QA-011: marketing 404 status | **Verified on a real nginx 1.27.4** with the production templates. |
| The 54/55 browser regression | **Root cause fixed**: a shared test account and a cancelled sign-up |
| 14 original findings | All still fixed: see below |
| 109 routes | See the verification document |

_Test and build figures are in "Results" below._

## NEW-1 — sessions

### Root cause
Each full page load restores the session with `POST /auth/refresh`, which **rotates** the single-use refresh token. Two things went wrong.

1. **Over-wide revocation.** Presenting a token that had already been rotated was treated as theft, and **every session of the user** was revoked (`revokeAllRefreshTokens`). If the browser abandoned a refresh after the server had rotated the token, the browser kept the old cookie. The next load sent it, and the user was signed out on every device.
2. **Non-atomic consumption.** The server checked "is this token active?" and deleted it later. Two simultaneous refreshes with the same token **both succeeded**, forking one token into two live sessions that reuse detection never saw. Found by the new concurrency test, and pre-existing.

### Fix
Smallest secure change. No grace period, nothing old is honoured, and reuse detection is still on.

- **Atomic consumption.** `consumeRefreshToken` uses Redis `DEL`, which reports 1 to exactly one caller. Any concurrent second presentation is a reuse, gets 401, and triggers revocation.
- **Session families.** Each sign-in starts a family, recorded in the token (`fam`) and in Redis; rotation keeps it. A reused token still gets **401**, and its **whole family is revoked**: the replayed chain and any successor an attacker obtained. Other devices' sign-ins never shared that token, so they survive.
  - This is the refresh-token-family model from the OAuth 2.0 Security Best Current Practice (RFC 9700).
  - Tokens issued before this release carry no family. They keep the old revoke-everything behaviour until they rotate.
- **Logout** revokes the presented token and its family.
- **Password change or reset** still revokes every session (unchanged).
- **Expired or invalid tokens** get 401 and revoke nothing.
- **Client** (`packages/utils/src/apiClient.ts`):
  - The refresh is sent with `keepalive`, so the browser still completes it and stores the rotated cookie if the page is left mid-request. This removes the interrupted-load trigger.
  - Refreshes are serialised across tabs with the Web Locks API, so two tabs never present the same token. Where Web Locks is unavailable, the refresh simply runs.

### Evidence
- **API tests** (`auth.controller.test.ts`, 8 new):
  - an interrupted refresh is refused, revokes only its own family, and other devices stay signed in;
  - rotation keeps the family, and a new sign-in starts a new one;
  - 5 concurrent refreshes give exactly one 200;
  - reuse is refused every time;
  - an expired token revokes nothing;
  - logout ends only this session;
  - a legacy token keeps revoke-all;
  - a password change revokes all.
- **Client tests** (`apiClient.test.ts`, 3 new): keepalive is set; two "tabs" refresh strictly one after another; it works without Web Locks.
- **Browser:**
  - the probe that previously signed the user out on attempt 6 now completes **30 interrupted page loads** (40 refreshes, all 200) with no sign-out;
  - Playwright "NEW-1": two tabs restoring the session together, 3 rounds, both stay signed in.

### Deployment note
Deploy the API and the frontends together, as already required for QA-012. Old frontends work with the new API; they just don't get the keepalive or the cross-tab lock.

## NEW-3 — staff role changes

- **Confirmation (Staff page).**
  - Choosing a new role opens a confirmation showing the person, the current and the new role, and "Their permissions change as soon as you confirm…" with the new role's access.
  - Cancel leaves everything unchanged, and the dropdown keeps showing the saved role.
  - Confirm is guarded against double clicks (an in-flight flag plus the dialog's busy state).
  - Choosing the current role does nothing.
- **Audit history.** `staff.role_changed` records:
  - restaurant ID, staff member (target) ID, the administrator (actor ID and role), previous and new role, and the time;
  - only when the role actually changes. The previous role is read in the same atomic update, so concurrent identical submissions record once.
- **Who can see it:** the existing tenant-checked audit log, `restaurant.audit.read`, which only owners and managers hold. Staff, kitchen and other restaurants get 403.
- **Tests:**
  - API (`staff.controller.test.ts`, 5 new): fields recorded; a double submission records once; a location-only update records nothing; staff and another tenant can't change roles; the audit entry is readable by owner and manager only.
  - Admin unit test for the confirmation text (2).
  - Playwright "NEW-3": cancel, then a double-clicked confirm makes exactly one save, and the audit-log entry appears.

## Kitchen and the customer directory

- **New permission:** `restaurant.customers.read`, enforced by the API (`customer.routes.ts`) and mirrored in the admin route and nav.
  - **Granted to:** owner, manager, front-of-house staff (the POS customer picker needs it), and the agency roles, which already had this access through orders.
  - **Not granted to:** kitchen staff.
- **Kitchen keeps everything it needs:** order lists and order details, including the customer on each order (`restaurant.orders.read` is unchanged).
- **Tests:**
  - API (`customer.controller.test.ts`, 4 new): owner, manager and staff allowed; kitchen gets 403 on the list and on customer history; kitchen still gets 200 on orders and an order's detail; another restaurant's staff get 403.
  - Playwright: kitchen gets an API 403, no nav link, `/customers` redirects, and the kitchen board works.

## QA-004 — plan entitlements

- **Server unchanged:** only `billing.read` roles (owner, manager) can read entitlements.
- **Admin app:** staff and kitchen pages still don't request them.
- **Tests:**
  - API (`subscription.controller.test.ts`, 3 new): owner and manager get 200; front-of-house staff and kitchen get 403; a platform admin gets 200 on `/platform/subscriptions`, and an owner gets 403 there.
  - Playwright: staff and kitchen pages make zero entitlement requests across load and refresh.

## QA-011 — marketing 404 status on real nginx

Docker still can't run here, because WSL isn't installed. So:
- I used the **official nginx 1.27.4 Windows build** from nginx.org. Its signature verified against the published release key (`D678 6CE3 03D9 A902 2998 DC6C C846 4D54 9AF7 5C0A`).
- Production uses `nginx:1.27-alpine`.
- The **production templates were rendered unchanged** except for what the image itself supplies: the `API_UPSTREAM` and `FRAME_ANCESTORS` values, the Linux paths, and the listen port. Script: `nginx-render.cjs`.
- One nginx served the real production builds of marketing (8081), storefront (8082) and admin (8083), and proxied `/api/` to the local API.

**Results:**
- `nginx -t`: **syntax is ok, test is successful.**
- **49/49 HTTP checks pass** (`nginx-http-test.cjs`, results in `evidence/release/nginx-http-results.json`):
  - **Marketing pages:** 12 pages, a trailing slash and `/Pricing` give **200**, with the app shell, `no-cache` and the security headers.
  - **Legal pages:** **200** with `X-Robots-Tag: noindex`.
  - **Unknown paths:** `/no-such-page`, `/v2`, `/pricing/extra`, `/deep/unknown/path` and `/index` give **404**, still with the app shell.
  - **Static files:** `robots.txt`, `sitemap.xml`, `og-image.png`, `favicon.svg`, `/v3/logo-mark.png` and a hashed asset (`immutable`) give 200. A missing asset gives 404.
  - **API proxy:** works from all three apps.
  - **Storefront and admin:** unchanged SPA fallback (200 for every path, by design, because slugs, tables and custom domains are dynamic), and their images are served.
- **Browser through nginx:**
  - `/no-such-page` and `/v2` give **404 and render "We couldn't find that page"**;
  - `/pricing` renders;
  - the Wildwood menu loads through the proxy;
  - the storefront root shows the branded fallback;
  - admin sign-in renders;
  - no page errors.

**Change made after this test:** Windows nginx matches locations case-insensitively, and so does the app's router. So the marketing page list now uses `~*`, making `/Pricing` give 200 on Linux too, instead of 404 with the pricing page shown. The unit test checks this.

**Remaining difference from production:** Linux versus Windows nginx. Everything else is the production configuration. The deploy rehearsal on the server, which isn't done (production untouched), would confirm it on Linux.

## The 54/55 browser regression

- **Classification.** Not an application race, and not a genuinely random flake. It was a **test isolation defect**.
- **Root cause.**
  - Six specs shared one customer, `customer1@test.local`, using "sign in, or register if missing, then navigate away".
  - On a freshly seeded database:
    - the first spec to need the account registered it, and parallel specs could race to register the same email (one gets a 409);
    - the immediate `goto` after "Create account" could cancel the register request before its session cookie was set, so the customer was signed out when placing the order.
  - That is why it failed in the batch on a fresh database and passed when rerun, because by then the account existed.
  - A second `online-payment` test also depended on the first test having created the account.
- **Fix.** `e2e/helpers/freshCustomer.ts` registers a unique customer per test and waits for the 201 and the redirect. The five specs using the shared account (`admin-audit-log`, `full-order-flow`, `kitchen-realtime`, `online-payment` ×2, `order-notification-toast`) now use it. No assertion was weakened or skipped, and nothing retries.

### Running the whole suite

The earlier 54/55 run covered 19 specs. Running all 145 tests surfaced more, each traced to a cause.

| Failing spec(s) | Cause | Fix |
|---|---|---|
| `pos-direct-access…`, `staff-invite-accept` | **Caused by NEW-3.** Each staff row's dropdown now has the accessible name "Role for <name>", and `getByLabel("Role")` became ambiguous. The invite form's dropdown had no name of its own; its name was "Role" plus every option's text. | Invite dropdown gets `aria-label="Role"`, and the specs use `getByLabel("Role", { exact: true })`. |
| 4 × `menu-import-*` journeys | **Environment.** Local Redis 3.0 can't run the BullMQ job queue (it needs 5+), so import jobs were never processed. Separately, the duplicate-import spec's fixture is a text buffer that only starts with `%PDF-`, which `main`'s upload validation (`08831ce`) rejects. **This was stale before this branch.** | Local runs now use Redis 8.10 on port 6380, a binary already installed on this machine. The duplicate spec builds a real PDF with `pdf-lib`, as the PDF journey already does. |
| `account-security` (email change) | **Test race.** It typed into `/account` before the signed-in page had loaded, and the input was lost under load. | It waits for the "Account" heading first, as the password test in the same file does. |
| `pos-delivery-order` | **Test race.** It waited for "Location set — …", which appears as soon as the coordinates are typed, not when the save finishes. The save's response then replaced the form and unticked the POS checkbox. | It waits for "Saved." |
| `full-order-flow` | Its ~25 s two-browser journey sat at the 30 s global default limit. The fresh-customer sign-up adds a few seconds. One run took 30.8 s. | Its own 60 s limit, like the other multi-actor journeys. |
| `payment-settings-and-loyalty` | 120 s test timeout in one full run. It passed alone and in the next three full runs. A trace wasn't captured that time (traces are now kept on failure). | None needed. Reported as unexplained, not hidden. |
| `admin-audit-log` (again, in the run after the `apiClient` type fix) | **A second test race, found from the trace.** The test clicked the kitchen's "Accept" and opened the Audit log straight away, so the list loaded before the status change had been recorded. | It waits for the status-change response first. Repeated 26 times: 25 passed. One run failed at a `toHaveURL` in the second of the first 3 repeats, with no trace kept; the next 23 in a row passed. **Reported as one unexplained failure.** |

**Product observation, not fixed:** on the owner Settings page, an edit made while a previous save is still in flight is overwritten when that save responds. It's minor, because users see the save complete, but worth a "saving…" lock later.

## The 14 original findings

All still fixed. Each has its unit, API or browser test in the final runs.

| ID | Status now |
|---|---|
| QA-001 signed-out promo | Fixed — API tests + browser |
| QA-002 dialog/cart price | Fixed — unit + browser |
| QA-003 `/restaurants/null` | Fixed — Playwright |
| QA-004 entitlement requests | Fixed; server unchanged — API + Playwright |
| QA-005 restaurant name | Fixed — unit + browser |
| QA-006 platform-admin support routing | Fixed — Playwright |
| QA-007 order-unavailable message | Fixed — unit + Playwright |
| QA-008 receipt logo | Fixed — unit + browser |
| QA-009 branded fallback | Fixed — unit + browser + through nginx |
| QA-010 `/v2` removed from production | Fixed — unit + real nginx 404 |
| QA-011 marketing 404 status | **Fixed and verified on real nginx** |
| QA-012 204 for no-session refresh | Fixed — API + client tests (deploy API and apps together) |
| QA-013 titles/description/cart h1 | Fixed — unit + browser |
| QA-014 mobile table/reset message | Fixed — Playwright |
| D-1 Stripe wording | "Coming soon" kept; no payment settings touched |

## Results (final code on this branch)

| Check | Result |
|---|---|
| API Jest (`restaurant_platform_test`) | **2250/2250 tests pass.** 161/162 suites passed in the full run. `businessAnalytics.controller.test.ts` (unchanged) passed all 14 tests but was marked failed by a Redis "Connection is closed" error during test teardown. Rerun alone it passed 3/3. |
| Admin Jest | 10 suites, **46/46** |
| Storefront Jest | 10 suites, **49/49** |
| Shared utilities Jest | 2 suites, **15/15** |
| Marketing `node --test` | **12/12** |
| Typecheck | `tsc -b` admin ✓, storefront ✓; API `tsc --noEmit` ✓ |
| Lint | **0 errors** everywhere. Warnings: admin 19, storefront 12, API 11, marketing 0. The only warning in a changed file (`StaffPage.tsx:54`, a hook dependency) is on an untouched line. |
| Production builds | shared packages ✓, storefront ✓, admin (also the agency, platform and POS portals) ✓, marketing ✓ (no `/v2` chunk), API ✓ |
| Playwright, full suite (145 tests incl. the 3 production-build legal checks) | Last full run: **144/145**. The failure was `account-security` (password change): the API's bcrypt hashing took 9.1 s under load against the test's 5 s default (other requests that minute were under 200 ms). The step now allows 15 s, and the spec then passed **9/9**. The previous full run's only failure (`admin-audit-log`) is fixed as described above. |
| Session lifecycle | API 8/8 + client 3 + browser probe 30 interrupted loads with no sign-out + two-tab Playwright test |
| Staff permissions and audit | API 5/5 (NEW-3), customer directory 4/4, entitlements 3/3; Playwright NEW-3, kitchen and QA-004 tests |
| nginx (real 1.27.4, production templates) | `nginx -t` ok; **49/49** HTTP checks; 6/6 browser checks through nginx |
| 14-fix browser checks (`verify-fixes.cjs`) | **60/60** on a freshly seeded database |
| Every route (`routes-all.cjs`) | **109/109 PASS** in one run on the final code, with 0 lost sessions. Details: [`full-browser-all-pages-verification.md`](full-browser-all-pages-verification.md). |

**Evidence:** [`evidence/release/`](evidence/release/). It holds the nginx results and rendered configuration, the route and fix-check results and logs, the Playwright log, and every script used.

## Remaining limitations

- QA-011 was verified on Windows nginx 1.27.4 with the production templates, not on the Linux `nginx:1.27-alpine` image.
- Tokens issued before this release keep revoke-all reuse detection until they rotate (by design, for compatibility).
- Local environment only: mock billing, payments and geocoding. Redis 3.0 locally means menu-import jobs aren't processed.
- Production wasn't touched, so nothing here was observed on production.
