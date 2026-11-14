# GarnishTable — Every Route, Verified After the Fixes

Branch `fix/full-browser-qa-findings`, local stack. Run on the isolated `restaurant_platform_e2e` database with mock providers. Companion to [`full-browser-qa-fixes.md`](full-browser-qa-fixes.md).

## How each route was tested

Each route was opened by URL, in its own page, as the role it is meant for. Automated by `routes-all.cjs` (Playwright, Chromium). For every route:

1. **Direct load.** HTTP status, the page lands where it should, no error boundary, real content.
2. **Functional test.** A check written for that route: a form submitted valid or invalid, a search, a tab, a dialog, a navigation, or a token page given a bad token.
3. **Controls sweep.** Up to 18 visible controls in the page body clicked (links, tabs, non-submitting buttons, selects), checking for page errors and 5xx after each. Destructive or data-changing controls (delete, pay, send, save, publish…) are skipped, so the forms are covered by steps 2 and 4 instead.
4. **Empty-form submit.** For a page with a form: clear a required field, submit, and record whether it was blocked with a message and whether anything returned a 5xx.
5. **Refresh.** Same page, still content.
6. **Back/Forward.** Through another page and back.
7. **390px.** The page reloaded at phone width; FAIL if the page itself scrolls sideways.
8. **Access.** A signed-out browser must land on `/login` for protected pages. A wrong role, where one applies, must be sent elsewhere.
9. **Console and network.** Page errors and 5xx are FAIL. API 4xx and console errors are listed for review; most are expected refusals the test itself provoked.

**Status:** PASS only when the functional test passed **and** no check failed. FAIL when any check failed. NOT TESTED when nothing functional was run.

**Production:** not touched. The fixes aren't deployed.

## Totals

| | Routes | PASS | FAIL | BLOCKED | NOT TESTED |
|---|---|---|---|---|---|
| marketing | 16 | 16 | 0 | 0 | 0 |
| storefront | 26 | 26 | 0 | 0 | 0 |
| admin | 67 | 67 | 0 | 0 | 0 |
| **all** | **109** | **109** | **0** | **0** | **0** |

Signed-in sessions lost during the run: 0.

**Re-run after correcting the test, not the product (2):** `/customers` (first run FAIL), `/mock-checkout/:token` (first run FAIL). The reason is in each route's notes.

## Limits — read before relying on "PASS"

- **One functional test per route.** Every route had a functional test run, and all passed. Depth varies: some exercise a whole flow (promo applied and removed, item added with an option, settings tabs, a search, an invalid-token submit); for simple content pages it is a navigation or content check.
- **Not every control was clicked.**
  - The sweep clicked **135** controls across the routes, and **0** on **46** routes. Those pages either had no safe control in the page body, or the first click navigated away, which ends the sweep.
  - Controls that change saved data were deliberately not clicked by the sweep: delete, pay, send, save, publish, role dropdowns, toggles. Where they matter they are covered by the functional tests, the fix checks (60/60) and the e2e specs.
- **Forms.** **12** routes had a form the empty-submit step could exercise. 11 were blocked with a message. On `/support` (storefront), an empty help search simply shows all articles, which is reasonable but marked REVIEW.
- **Environment.**
  - Mock billing, payment and geocoding providers; nothing real was charged, sent or connected.
  - The local Redis is too old for the job queue, so menu-import jobs stay queued.
  - Docker could not run, so marketing's server-side 404 status (QA-011) wasn't exercised.
- **Discarded run.** An earlier full run was discarded because the sweep changed staff roles through instant-save dropdowns (NEW-3). The database was reset to a fresh seed and every route was re-run.

## Marketing (16)

### R-001 · `/` — **PASS**

| | |
|---|---|
| URL / role | `/` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Your restaurant. Running on your terms." |
| Functional test | PASS: nav → pricing |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_-anon.png` (+ `-390.png`) |
| Defect | D-1 wording fixed (home caption); QA-012 fixed |

### R-002 · `/about` — **PASS**

| | |
|---|---|
| URL / role | `/about` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Restaurants shouldn't have to rent back what they built" |
| Functional test | PASS: Restaurants shouldn't have to rent back what they built |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_about-anon.png` (+ `-390.png`) |
| Defect | — |

### R-003 · `/contact` — **PASS**

| | |
|---|---|
| URL / role | `/contact` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Let's build a better ordering experience for your restaurant" |
| Functional test | PASS: empty submit blocked (3 invalid fields); not sent |
| Controls tested | PASS — 1 safe controls: a:live demo |
| Form (empty submit) | PASS — blocked with message (submit "Send message", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_contact-anon.png` (+ `-390.png`) |
| Defect | — |

### R-004 · `/demo` — **PASS**

| | |
|---|---|
| URL / role | `/demo` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Play with a real restaurant, not a mockup" |
| Functional test | PASS: 4 demo links/embeds |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | PASS — blocked with message (submit "Request a guided demo", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_demo-anon.png` (+ `-390.png`) |
| Defect | — |

### R-005 · `/faq` — **PASS**

| | |
|---|---|
| URL / role | `/faq` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Frequently asked questions" |
| Functional test | PASS: question expanded; payment answer accurate |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_faq-anon.png` (+ `-390.png`) |
| Defect | D-1 wording fixed (payments answer) |

### R-006 · `/how-it-works` — **PASS**

| | |
|---|---|
| URL / role | `/how-it-works` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "From signup to your first order" |
| Functional test | PASS: From signup to your first order |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_how_it_works-anon.png` (+ `-390.png`) |
| Defect | — |

### R-007 · `/pricing` — **PASS**

| | |
|---|---|
| URL / role | `/pricing` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Simple pricing, built to grow with you" |
| Functional test | PASS: plans shown, interval toggle clicked |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_pricing-anon.png` (+ `-390.png`) |
| Defect | D-1 wording fixed (pricing note) |

### R-008 · `/privacy` — **PASS**

| | |
|---|---|
| URL / role | `/privacy` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Privacy Policy" |
| Functional test | PASS: Privacy Policy |
| Controls tested | PASS — 1 safe controls: a:contact page |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_privacy-anon.png` (+ `-390.png`) |
| Defect | — |

### R-009 · `/product` — **PASS**

| | |
|---|---|
| URL / role | `/product` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Look inside the machine" |
| Functional test | PASS: Look inside the machine |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_product-anon.png` (+ `-390.png`) |
| Defect | — |

### R-010 · `/refund-policy` — **PASS**

| | |
|---|---|
| URL / role | `/refund-policy` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Refund & Cancellation Policy" |
| Functional test | PASS: Refund & Cancellation Policy |
| Controls tested | PASS — 1 safe controls: a:contact page |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_refund_policy-anon.png` (+ `-390.png`) |
| Defect | — |

### R-011 · `/solutions` — **PASS**

| | |
|---|---|
| URL / role | `/solutions` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "How different restaurants use the system" |
| Functional test | PASS: How different restaurants use the system |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_solutions-anon.png` (+ `-390.png`) |
| Defect | — |

### R-012 · `/start-trial` — **PASS**

| | |
|---|---|
| URL / role | `/start-trial` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Get your restaurant online without the complexity" |
| Functional test | PASS: 4 sign-up links |
| Controls tested | PASS — 1 safe controls: a:Pricing |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_start_trial-anon.png` (+ `-390.png`) |
| Defect | — |

### R-013 · `/terms` — **PASS**

| | |
|---|---|
| URL / role | `/terms` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Terms of Service" |
| Functional test | PASS: Terms of Service |
| Controls tested | PASS — 1 safe controls: a:Privacy Policy |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_terms-anon.png` (+ `-390.png`) |
| Defect | — |

### R-014 · `/v2` — **PASS**

| | |
|---|---|
| URL / role | `/v2` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Your restaurant. Running on your terms." |
| Functional test | PASS: dev: draft (intended); production build: "We couldn't find that page" |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_v2-anon.png` (+ `-390.png`) |
| Defect | QA-010 fixed (production build: 404 page) |

### R-015 · `/v3` — **PASS**

| | |
|---|---|
| URL / role | `/v3` · signed out |
| Direct load | PASS (landed on `/`) |
| Rendering | PASS — h1 "Your restaurant. Running on your terms." |
| Functional test | PASS: → / |
| Controls tested | PASS — 1 safe controls: a:Explore the demo |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_v3-anon.png` (+ `-390.png`) |
| Defect | — |

### R-016 · `*` — **PASS**

| | |
|---|---|
| URL / role | `/no-such-page-qa` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "We couldn't find that page" |
| Functional test | PASS: 404 page → homepage link works |
| Controls tested | PASS — 1 safe controls: a:Contact us |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `marketing-_-anon.png` (+ `-390.png`) |
| Defect | QA-011 — 404 status needs nginx (not run locally) |

## Storefront (26)

### R-017 · `/` — **PASS**

| | |
|---|---|
| URL / role | `/` · signed out |
| Direct load | PASS (landed on `/r/demo-restaurant`) |
| Rendering | PASS — h1 "Wildwood Kitchen" |
| Functional test | PASS: → /r/demo-restaurant (VITE_RESTAURANT_SLUG) |
| Controls tested | PASS — 8 safe controls: button:RESERVE THE MENU, button:WOOD-FIRED PIZZA, button:SMASH BURGERS, button:SALADS, button:DESSERTS, button:FROM THE GRILL, button:DRINKS, button:VIEW THE MENU |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_-anon.png` (+ `-390.png`) |
| Defect | QA-009 fixed (platform host); QA-012 fixed |

### R-018 · `/r/:restaurantSlug` — **PASS**

| | |
|---|---|
| URL / role | `/r/demo-restaurant` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Wildwood Kitchen" |
| Functional test | PASS: added Margherita (Medium): "ADD TO ORDER — $14.50" |
| Controls tested | PASS — 8 safe controls: button:RESERVE THE MENU, button:WOOD-FIRED PIZZA, button:SMASH BURGERS, button:SALADS, button:DESSERTS, button:FROM THE GRILL, button:DRINKS, button:VIEW THE MENU |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_r_restaurantSlug-anon.png` (+ `-390.png`) |
| Defect | QA-002 fixed; QA-012 fixed |

### R-019 · `/r/:restaurantSlug/cart` — **PASS**

| | |
|---|---|
| URL / role | `/r/demo-restaurant/cart` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "Cart" |
| Functional test | PASS: empty cart → browse works |
| Controls tested | PASS — 1 safe controls: button:Browse the menu |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_r_restaurantSlug_cart-customer.png` (+ `-390.png`) |
| Defect | QA-001, QA-002, QA-013 fixed |

### R-020 · `/r/:restaurantSlug/experience` — **PASS**

| | |
|---|---|
| URL / role | `/r/demo-restaurant/experience` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "This is Wildwood Kitchen, running on our platform." |
| Functional test | PASS: 52 controls; one clicked |
| Controls tested | PASS — 1 safe controls: button:Order online |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_r_restaurantSlug_experience-anon.png` (+ `-390.png`) |
| Defect | — |
| Notes | choosing "Order online" in the playground signs the browser in as a temporary Demo Guest (by design) |

### R-021 · `/r/:restaurantSlug/loyalty` — **PASS**

| | |
|---|---|
| URL / role | `/r/demo-restaurant/loyalty` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "Loyalty" |
| Functional test | PASS: Loyalty 52 points Bronze tier Rewards No rewards set up yet — you can still rede |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_r_restaurantSlug_loyalty-customer.png` (+ `-390.png`) |
| Defect | — |

### R-022 · `/r/:restaurantSlug/preview` — **PASS**

| | |
|---|---|
| URL / role | `/r/demo-restaurant/preview` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "(no h1)" |
| Functional test | PASS: We can't find that restaurant This link doesn't match a restaurant we know about — it may have been  |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (3 API 4xx, 3 console errors). API: 401 GET /api/v1/restaurants/by-slug/demo-restaurant/preview, 403 GET /api/v1/restaurants/by-slug/demo-restaurant/preview, 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_r_restaurantSlug_preview-customer.png` (+ `-390.png`) |
| Defect | — |
| Notes | a customer is refused the owner-only preview (403) — the expected outcome; the 401→refresh→403 sequence is the client restoring the session first |

### R-023 · `/r/:restaurantSlug/t/:tableToken` — **PASS**

| | |
|---|---|
| URL / role | `/r/demo-restaurant/t/fd71e5d71e5a81064a64b1b65bae6fd8` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Wildwood Kitchen" |
| Functional test | PASS: table banner shown |
| Controls tested | PASS — 8 safe controls: button:RESERVE THE MENU, button:WOOD-FIRED PIZZA, button:SMASH BURGERS, button:SALADS, button:DESSERTS, button:FROM THE GRILL, button:DRINKS, button:VIEW THE MENU |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_r_restaurantSlug_t_tableToken-anon.png` (+ `-390.png`) |
| Defect | — |

### R-024 · `/t/:tableToken` — **PASS**

| | |
|---|---|
| URL / role | `/t/fd71e5d71e5a81064a64b1b65bae6fd8` · signed out |
| Direct load | PASS (landed on `/r/demo-restaurant/t/fd71e5d71e5a81064a64b1b65bae6fd8`) |
| Rendering | PASS — h1 "Wildwood Kitchen" |
| Functional test | PASS: → /r/demo-restaurant/t/… |
| Controls tested | PASS — 8 safe controls: button:RESERVE THE MENU, button:WOOD-FIRED PIZZA, button:SMASH BURGERS, button:SALADS, button:DESSERTS, button:FROM THE GRILL, button:DRINKS, button:VIEW THE MENU |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_t_tableToken-anon.png` (+ `-390.png`) |
| Defect | — |

### R-025 · `/cart` — **PASS**

| | |
|---|---|
| URL / role | `/cart` · signed out |
| Direct load | PASS (landed on `/r/demo-restaurant/cart`) |
| Rendering | PASS — h1 "Cart" |
| Functional test | PASS: → restaurant cart |
| Controls tested | PASS — 1 safe controls: button:Browse the menu |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_cart-anon.png` (+ `-390.png`) |
| Defect | QA-013 fixed |

### R-026 · `/loyalty` — **PASS**

| | |
|---|---|
| URL / role | `/loyalty` · customer (Jordan) |
| Direct load | PASS (landed on `/r/demo-restaurant/loyalty`) |
| Rendering | PASS — h1 "Loyalty" |
| Functional test | PASS: /r/demo-restaurant/loyalty |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_loyalty-customer.png` (+ `-390.png`) |
| Defect | — |

### R-027 · `/account` — **PASS**

| | |
|---|---|
| URL / role | `/account` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "Account" |
| Functional test | PASS: profile form editable (not saved) |
| Controls tested | PASS — 1 safe controls: button:Edit |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_account-customer.png` (+ `-390.png`) |
| Defect | — |

### R-028 · `/orders` — **PASS**

| | |
|---|---|
| URL / role | `/orders` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "My orders" |
| Functional test | PASS: opened an order from the list |
| Controls tested | PASS — 1 safe controls: a:ORD-1004 |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_orders-customer.png` (+ `-390.png`) |
| Defect | — |

### R-029 · `/orders/:id` — **PASS**

| | |
|---|---|
| URL / role | `/orders/6aeff13726baf4f1c95b9543` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "Order ORD-1004" |
| Functional test | PASS: ORD-1004 |
| Controls tested | PASS — 1 safe controls: button:Order again |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_orders_id-customer.png` (+ `-390.png`) |
| Defect | QA-007 fixed |

### R-030 · `/orders/:id/receipt` — **PASS**

| | |
|---|---|
| URL / role | `/orders/6aeff13726baf4f1c95b9543/receipt` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "(no h1)" |
| Functional test | PASS: receipt rendered |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_orders_id_receipt-customer.png` (+ `-390.png`) |
| Defect | QA-007 fixed (same message) |

### R-031 · `/support` — **PASS**

| | |
|---|---|
| URL / role | `/support` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Support" |
| Functional test | PASS: opened an article |
| Controls tested | PASS — 2 safe controls: button:All, button:Ordering & Delivery |
| Form (empty submit) | REVIEW (no visible validation) (submit "Search", native-invalid false, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_support-anon.png` (+ `-390.png`) |
| Defect | — |

### R-032 · `/support/articles/:slug` — **PASS**

| | |
|---|---|
| URL / role | `/support/articles/how-do-i-place-an-order` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "How do I place an order?" |
| Functional test | PASS: How do I place an order? |
| Controls tested | PASS — 1 safe controls: a:Support |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_support_articles_slug-anon.png` (+ `-390.png`) |
| Defect | — |

### R-033 · `/support/tickets` — **PASS**

| | |
|---|---|
| URL / role | `/support/tickets` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "My support tickets" |
| Functional test | PASS: My support tickets New ticket Payment shows as unpaid after pickup In progress T |
| Controls tested | PASS — 1 safe controls: a:Payment shows as unpaid after pickup In progress TKT-1003 ·  |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_support_tickets-customer.png` (+ `-390.png`) |
| Defect | — |

### R-034 · `/support/tickets/new` — **PASS**

| | |
|---|---|
| URL / role | `/support/tickets/new` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "Contact support" |
| Functional test | PASS: empty form stays on page (not submitted) |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_support_tickets_new-customer.png` (+ `-390.png`) |
| Defect | — |

### R-035 · `/support/tickets/:id` — **PASS**

| | |
|---|---|
| URL / role | `/support/tickets/6aeff13926baf4f1c95b957b` · customer (Jordan) |
| Direct load | PASS |
| Rendering | PASS — h1 "Payment shows as unpaid after pickup" |
| Functional test | PASS: Payment shows as unpaid after pickup |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_support_tickets_id-customer.png` (+ `-390.png`) |
| Defect | — |

### R-036 · `/login` — **PASS**

| | |
|---|---|
| URL / role | `/login` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Log in" |
| Functional test | PASS: Invalid email or password |
| Controls tested | PASS — 1 safe controls: a:Forgot password? |
| Form (empty submit) | PASS — blocked with message (submit "Log in", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (2 API 4xx, 2 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost, 401 POST /api/v1/auth/login |
| Evidence | `storefront-_login-anon.png` (+ `-390.png`) |
| Defect | QA-013 fixed (title) |

### R-037 · `/register` — **PASS**

| | |
|---|---|
| URL / role | `/register` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Create account" |
| Functional test | PASS: empty submit blocked |
| Controls tested | PASS — 1 safe controls: a:Log in |
| Form (empty submit) | PASS — blocked with message (submit "Create account", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_register-anon.png` (+ `-390.png`) |
| Defect | — |

### R-038 · `/forgot-password` — **PASS**

| | |
|---|---|
| URL / role | `/forgot-password` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Reset your password" |
| Functional test | PASS: same answer for unknown email |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | PASS — blocked with message (submit "Send reset link", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_forgot_password-anon.png` (+ `-390.png`) |
| Defect | — |

### R-039 · `/reset-password` — **PASS**

| | |
|---|---|
| URL / role | `/reset-password?token=invalid-qa-token` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Set a new password" |
| Functional test | PASS: invalid token refused: This reset link is invalid or has expired |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | PASS — blocked with message (submit "Update password", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (2 API 4xx, 2 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost, 400 POST /api/v1/auth/reset-password |
| Evidence | `storefront-_reset_password-anon.png` (+ `-390.png`) |
| Defect | QA-014 fixed (missing-token message) |

### R-040 · `/verify-email` — **PASS**

| | |
|---|---|
| URL / role | `/verify-email?token=invalid-qa-token` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Verify email address" |
| Functional test | PASS: invalid token message |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (2 API 4xx, 4 console errors). API: 400 POST /api/v1/auth/verify-email, 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_verify_email-anon.png` (+ `-390.png`) |
| Defect | — |

### R-041 · `/confirm-email-change` — **PASS**

| | |
|---|---|
| URL / role | `/confirm-email-change?token=invalid-qa-token` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Confirm email address" |
| Functional test | PASS: invalid token handled |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (2 API 4xx, 4 console errors). API: 400 POST /api/v1/auth/confirm-email-change, 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_confirm_email_change-anon.png` (+ `-390.png`) |
| Defect | — |

### R-042 · `*` — **PASS**

| | |
|---|---|
| URL / role | `/no-such-storefront-page` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Page not found" |
| Functional test | PASS: 404 → home |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 404 GET /api/v1/restaurants/by-domain/localhost |
| Evidence | `storefront-_-anon.png` (+ `-390.png`) |
| Defect | QA-009 fixed (branded on platform host) |

## Admin (67)

### R-043 · `/` — **PASS**

| | |
|---|---|
| URL / role | `/` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Good morning, Wildwood Kitchen." |
| Functional test | PASS: dashboard → Orders nav |
| Controls tested | PASS — 1 safe controls: a:View orders |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_-owner.png` (+ `-390.png`) |
| Defect | — |

### R-044 · `/accept-agency-invite` — **PASS**

| | |
|---|---|
| URL / role | `/accept-agency-invite?token=invalid-qa` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Accept your agency invitation" |
| Functional test | PASS: invalid token refused: This invitation link is invalid or has expired |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 400 POST /api/v1/agencies/accept-invite |
| Evidence | `admin-_accept_agency_invite-anon.png` (+ `-390.png`) |
| Defect | — |

### R-045 · `/accept-invite` — **PASS**

| | |
|---|---|
| URL / role | `/accept-invite?token=invalid-qa` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Set your password" |
| Functional test | PASS: invalid invite token refused |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 400 POST /api/v1/auth/accept-invite |
| Evidence | `admin-_accept_invite-anon.png` (+ `-390.png`) |
| Defect | — |

### R-046 · `/agency` — **PASS**

| | |
|---|---|
| URL / role | `/agency` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "QA Routes Agency 1794109900019" |
| Functional test | PASS: agency overview |
| Controls tested | PASS — 1 safe controls: a:Manage billing |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency-agency.png` (+ `-390.png`) |
| Defect | — |

### R-047 · `/agency/activity` — **PASS**

| | |
|---|---|
| URL / role | `/agency/activity` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "Activity" |
| Functional test | PASS: audit entry listed |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_activity-agency.png` (+ `-390.png`) |
| Defect | — |

### R-048 · `/agency/billing` — **PASS**

| | |
|---|---|
| URL / role | `/agency/billing` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "Agency billing" |
| Functional test | PASS: Agency billing |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_billing-agency.png` (+ `-390.png`) |
| Defect | — |

### R-049 · `/agency/businesses` — **PASS**

| | |
|---|---|
| URL / role | `/agency/businesses` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "Clients" |
| Functional test | PASS: new-client wizard opens |
| Controls tested | PASS — 1 safe controls: button:Sort descending |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_businesses-agency.png` (+ `-390.png`) |
| Defect | — |

### R-050 · `/agency/businesses/:businessId` — **PASS**

| | |
|---|---|
| URL / role | `/agency/businesses/6aeff1e95910fd2efd7450af` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "QA Routes Client 1794109900019" |
| Functional test | PASS: client detail |
| Controls tested | PASS — 1 safe controls: button:Manage this business |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_businesses_businessId-agency.png` (+ `-390.png`) |
| Defect | — |

### R-051 · `/agency/locations` — **PASS**

| | |
|---|---|
| URL / role | `/agency/locations` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "Locations" |
| Functional test | PASS: location listed |
| Controls tested | PASS — 1 safe controls: a:QA Routes Location 1794109900019 |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_locations-agency.png` (+ `-390.png`) |
| Defect | — |

### R-052 · `/agency/locations/:locationId` — **PASS**

| | |
|---|---|
| URL / role | `/agency/locations/6aeff1e95910fd2efd7450b1` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "QA Routes Location 1794109900019" |
| Functional test | PASS: location detail |
| Controls tested | PASS — 1 safe controls: a:QA ROUTES CLIENT 1794109900019 |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_locations_locationId-agency.png` (+ `-390.png`) |
| Defect | — |

### R-053 · `/agency/members` — **PASS**

| | |
|---|---|
| URL / role | `/agency/members` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "Team" |
| Functional test | PASS: members listed |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_members-agency.png` (+ `-390.png`) |
| Defect | — |

### R-054 · `/agency/settings` — **PASS**

| | |
|---|---|
| URL / role | `/agency/settings` · agency owner (created) |
| Direct load | PASS |
| Rendering | PASS — h1 "Agency settings" |
| Functional test | PASS: profile saved |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | PASS — blocked with message (submit "Save profile", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_agency_settings-agency.png` (+ `-390.png`) |
| Defect | — |

### R-055 · `/analytics` — **PASS**

| | |
|---|---|
| URL / role | `/analytics` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Analytics" |
| Functional test | PASS: analytics + range control |
| Controls tested | PASS — 5 safe controls: button:Revenue, button:Orders, button:7 days, button:30 days, button:90 days |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_analytics-owner.png` (+ `-390.png`) |
| Defect | — |

### R-056 · `/audit-log` — **PASS**

| | |
|---|---|
| URL / role | `/audit-log` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Audit log" |
| Functional test | PASS: entries listed |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — staff → /orders |
| Console / network | PASS |
| Evidence | `admin-_audit_log-owner.png` (+ `-390.png`) |
| Defect | — |

### R-057 · `/billing` — **PASS**

| | |
|---|---|
| URL / role | `/billing` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Billing" |
| Functional test | PASS: Billing |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — staff → /orders |
| Console / network | PASS |
| Evidence | `admin-_billing-owner.png` (+ `-390.png`) |
| Defect | — |

### R-058 · `/business-analytics` — **PASS**

| | |
|---|---|
| URL / role | `/business-analytics` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Business Analytics" |
| Functional test | PASS: Business Analytics |
| Controls tested | PASS — 2 safe controls: button:Orders, button:Revenue (USD) |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_business_analytics-owner.png` (+ `-390.png`) |
| Defect | — |

### R-059 · `/business-promotions` — **PASS**

| | |
|---|---|
| URL / role | `/business-promotions` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Business Promotions" |
| Functional test | PASS: Business Promotions |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_business_promotions-owner.png` (+ `-390.png`) |
| Defect | — |

### R-060 · `/customers` — **PASS**

| | |
|---|---|
| URL / role | `/customers` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Customers" |
| Functional test | PASS: search found Jordan |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — admin → /platform |
| Console / network | PASS |
| Evidence | `admin-_customers-owner.png` (+ `-390.png`) |
| Defect | QA-003 fixed; D-3 (kitchen access by design) |
| Notes | re-run (first run FAIL); kitchen/staff may open Customers by design (restaurant.orders.read) — see D-3 |

### R-061 · `/delivery` — **PASS**

| | |
|---|---|
| URL / role | `/delivery` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Delivery" |
| Functional test | PASS: Delivery |
| Controls tested | PASS — 2 safe controls: a:Zoom in, a:Zoom out |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_delivery-owner.png` (+ `-390.png`) |
| Defect | — |

### R-062 · `/force-password-change` — **PASS**

| | |
|---|---|
| URL / role | `/force-password-change` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Set your password" |
| Functional test | PASS: → /force-password-change (no forced change pending) |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_force_password_change-owner.png` (+ `-390.png`) |
| Defect | — |

### R-063 · `/forgot-password` — **PASS**

| | |
|---|---|
| URL / role | `/forgot-password` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Reset your password" |
| Functional test | PASS: neutral confirmation |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_forgot_password-anon.png` (+ `-390.png`) |
| Defect | — |

### R-064 · `/kitchen` — **PASS**

| | |
|---|---|
| URL / role | `/kitchen` · kitchen |
| Direct load | PASS |
| Rendering | PASS — h1 "Kitchen" |
| Functional test | PASS: Kitchen |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_kitchen-kitchen.png` (+ `-390.png`) |
| Defect | QA-003, QA-004 fixed |
| Notes | forward landed on /kitchen |

### R-065 · `/locations` — **PASS**

| | |
|---|---|
| URL / role | `/locations` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Locations" |
| Functional test | PASS: Locations |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — staff → /orders |
| Console / network | PASS |
| Evidence | `admin-_locations-owner.png` (+ `-390.png`) |
| Defect | — |

### R-066 · `/login` — **PASS**

| | |
|---|---|
| URL / role | `/login` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Sign in" |
| Functional test | PASS: Invalid email or password |
| Controls tested | PASS — 1 safe controls: a:Forgot password? |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 401 POST /api/v1/auth/login |
| Evidence | `admin-_login-anon.png` (+ `-390.png`) |
| Defect | — |

### R-067 · `/loyalty` — **PASS**

| | |
|---|---|
| URL / role | `/loyalty` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Loyalty" |
| Functional test | PASS: Loyalty |
| Controls tested | PASS — 1 safe controls: a:Customers page |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_loyalty-owner.png` (+ `-390.png`) |
| Defect | — |

### R-068 · `/marketplace` — **PASS**

| | |
|---|---|
| URL / role | `/marketplace` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Marketplace integrations" |
| Functional test | PASS: Marketplace integrations |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_marketplace-owner.png` (+ `-390.png`) |
| Defect | — |

### R-069 · `/marketplace/oauth-callback` — **PASS**

| | |
|---|---|
| URL / role | `/marketplace/oauth-callback` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "(no h1)" |
| Functional test | PASS: no-code callback handled |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_marketplace_oauth_callback-owner.png` (+ `-390.png`) |
| Defect | — |

### R-070 · `/menu` — **PASS**

| | |
|---|---|
| URL / role | `/menu` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Menu" |
| Functional test | PASS: item opened (inline) |
| Controls tested | PASS — 12 safe controls: button:All items 28, button:Wood-Fired Pizza 5, button:Smash Burgers 4, button:Salads 3, button:Desserts 3, button:From the Grill 4, button:Drinks 5, button:Live preview, button:Collapse Wood-Fired Pizza, button:Rename… |
| Form (empty submit) | PASS — blocked with message (submit "Add category", native-invalid true, messages 35) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_menu-owner.png` (+ `-390.png`) |
| Defect | QA-003 fixed |

### R-071 · `/menu/import` — **PASS**

| | |
|---|---|
| URL / role | `/menu/import` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Bring your menu to GarnishTable" |
| Functional test | PASS: Bring your menu to GarnishTable |
| Controls tested | PASS — 1 safe controls: a:Menu |
| Form (empty submit) | PASS — blocked with message (submit "Import", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_menu_import-owner.png` (+ `-390.png`) |
| Defect | — |

### R-072 · `/menu/import/csv` — **PASS**

| | |
|---|---|
| URL / role | `/menu/import/csv` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Import from a spreadsheet" |
| Functional test | PASS: Import from a spreadsheet |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_menu_import_csv-owner.png` (+ `-390.png`) |
| Defect | — |

### R-073 · `/menu/import/job/:jobId` — **PASS**

| | |
|---|---|
| URL / role | `/menu/import/job/6aeff1cf5910fd2efd744fc6` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "We couldn't read this page" |
| Functional test | PASS: We couldn't read this page |
| Controls tested | PASS — 1 safe controls: a:Try another file |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_menu_import_job_jobId-owner.png` (+ `-390.png`) |
| Defect | — |
| Notes | local Redis 3.0 is too old for the job queue, so the job stays queued here; the page itself renders and refreshes |

### R-074 · `/mock-checkout/:token` — **PASS**

| | |
|---|---|
| URL / role | `/mock-checkout/bca4230af4fda4cb4b64cefd87c459b8?ownerType=business` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Mock checkout" |
| Functional test | PASS: Mock checkout |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_mock_checkout_token-owner.png` (+ `-390.png`) |
| Defect | — |
| Notes | re-run (first run FAIL); public by design: the token is the credential; exists only with mock billing |

### R-075 · `/orders` — **PASS**

| | |
|---|---|
| URL / role | `/orders` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Orders" |
| Functional test | PASS: 2 order groups |
| Controls tested | PASS — 1 safe controls: button:ORD-1004 |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_orders-owner.png` (+ `-390.png`) |
| Defect | QA-003 fixed |

### R-076 · `/platform` — **PASS**

| | |
|---|---|
| URL / role | `/platform` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Platform dashboard" |
| Functional test | PASS: → restaurants |
| Controls tested | PASS — 1 safe controls: a:View all |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform-admin.png` (+ `-390.png`) |
| Defect | — |

### R-077 · `/platform/agencies` — **PASS**

| | |
|---|---|
| URL / role | `/platform/agencies` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Agencies" |
| Functional test | PASS: new agency listed |
| Controls tested | PASS — 1 safe controls: button:Plan |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_agencies-admin.png` (+ `-390.png`) |
| Defect | — |

### R-078 · `/platform/analytics` — **PASS**

| | |
|---|---|
| URL / role | `/platform/analytics` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Platform analytics" |
| Functional test | PASS: Platform analytics |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_analytics-admin.png` (+ `-390.png`) |
| Defect | — |

### R-079 · `/platform/refunds` — **PASS**

| | |
|---|---|
| URL / role | `/platform/refunds` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Waiting refunds" |
| Functional test | PASS: Waiting refunds |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_refunds-admin.png` (+ `-390.png`) |
| Defect | — |

### R-080 · `/platform/restaurants` — **PASS**

| | |
|---|---|
| URL / role | `/platform/restaurants` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Restaurants" |
| Functional test | PASS: search → Wildwood |
| Controls tested | PASS — 1 safe controls: a:QA Routes Location 1794109900019 |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_restaurants-admin.png` (+ `-390.png`) |
| Defect | — |

### R-081 · `/platform/restaurants/:id` — **PASS**

| | |
|---|---|
| URL / role | `/platform/restaurants/6aeff11e26baf4f1c95b9439` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Wildwood Kitchen active" |
| Functional test | PASS: detail |
| Controls tested | PASS — 1 safe controls: button:← All restaurants |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_restaurants_id-admin.png` (+ `-390.png`) |
| Defect | — |

### R-082 · `/platform/restaurants/new` — **PASS**

| | |
|---|---|
| URL / role | `/platform/restaurants/new` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Create restaurant" |
| Functional test | PASS: empty create blocked |
| Controls tested | PASS — 1 safe controls: a:← Restaurants |
| Form (empty submit) | PASS — blocked with message (submit "Create restaurant & send invite", native-invalid true, messages 0) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_restaurants_new-admin.png` (+ `-390.png`) |
| Defect | — |

### R-083 · `/platform/settings` — **PASS**

| | |
|---|---|
| URL / role | `/platform/settings` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "System configuration" |
| Functional test | PASS: System configuration |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_settings-admin.png` (+ `-390.png`) |
| Defect | — |

### R-084 · `/platform/subscriptions` — **PASS**

| | |
|---|---|
| URL / role | `/platform/subscriptions` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Subscriptions" |
| Functional test | PASS: Subscriptions |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_subscriptions-admin.png` (+ `-390.png`) |
| Defect | — |

### R-085 · `/platform/support` — **PASS**

| | |
|---|---|
| URL / role | `/platform/support` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Support" |
| Functional test | PASS: opened ticket |
| Controls tested | PASS — 1 safe controls: a:Payment shows as unpaid after pickup |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_support-admin.png` (+ `-390.png`) |
| Defect | QA-014 fixed; NEW-2 fixed |
| Notes | forward landed on /platform |

### R-086 · `/platform/support/kb` — **PASS**

| | |
|---|---|
| URL / role | `/platform/support/kb` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Knowledge base" |
| Functional test | PASS: Knowledge base |
| Controls tested | PASS — 7 safe controls: button:Edit, button:Edit, button:Edit, button:Edit, button:Edit, button:Edit, button:Edit |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_support_kb-admin.png` (+ `-390.png`) |
| Defect | — |

### R-087 · `/platform/support/tickets/:id` — **PASS**

| | |
|---|---|
| URL / role | `/platform/support/tickets/6aeff13926baf4f1c95b957b` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Payment shows as unpaid after pickup" |
| Functional test | PASS: Payment shows as unpaid after pickup |
| Controls tested | PASS — 1 safe controls: button:Unassign |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_support_tickets_id-admin.png` (+ `-390.png`) |
| Defect | NEW-2 fixed |

### R-088 · `/platform/users` — **PASS**

| | |
|---|---|
| URL / role | `/platform/users` · platform admin |
| Direct load | PASS |
| Rendering | PASS — h1 "Users" |
| Functional test | PASS: search found owner |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — owner → / |
| Console / network | PASS |
| Evidence | `admin-_platform_users-admin.png` (+ `-390.png`) |
| Defect | — |

### R-089 · `/pos` — **PASS**

| | |
|---|---|
| URL / role | `/pos` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Register" |
| Functional test | PASS: /pos |
| Controls tested | PASS — 13 safe controls: button:Wood-Fired Pizza, button:Smash Burgers, button:Salads, button:Desserts, button:From the Grill, button:Drinks, button:Select customer Choose, button:Pickup, button:Dine In, button:Delivery… |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_pos-owner.png` (+ `-390.png`) |
| Defect | — |

### R-090 · `/pos/customers` — **PASS**

| | |
|---|---|
| URL / role | `/pos/customers` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Customers" |
| Functional test | PASS: ok |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_pos_customers-owner.png` (+ `-390.png`) |
| Defect | — |

### R-091 · `/pos/orders` — **PASS**

| | |
|---|---|
| URL / role | `/pos/orders` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Orders" |
| Functional test | PASS: ok |
| Controls tested | PASS — 2 safe controls: button:Active, button:All |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 403 GET /api/v1/restaurants/null |
| Evidence | `admin-_pos_orders-owner.png` (+ `-390.png`) |
| Defect | — |

### R-092 · `/pos/pending` — **PASS**

| | |
|---|---|
| URL / role | `/pos/pending` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Pending sales" |
| Functional test | PASS: ok |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_pos_pending-owner.png` (+ `-390.png`) |
| Defect | — |

### R-093 · `/pos/tables` — **PASS**

| | |
|---|---|
| URL / role | `/pos/tables` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Tables" |
| Functional test | PASS: ok |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_pos_tables-owner.png` (+ `-390.png`) |
| Defect | — |

### R-094 · `/print/:mode/:id` — **PASS**

| | |
|---|---|
| URL / role | `/print/receipt/6aeff13726baf4f1c95b9543` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "(no h1)" |
| Functional test | PASS: receipt + logo |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_print_mode_id-owner.png` (+ `-390.png`) |
| Defect | QA-008 fixed |

### R-095 · `/print/preview/:jobId` — **PASS**

| | |
|---|---|
| URL / role | `/print/preview/6aeff1cf5910fd2efd744fbe` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "(no h1)" |
| Functional test | PASS: preview rendered |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 403 GET /api/v1/restaurants/null/print-jobs/6aeff1cf5910fd2efd744fbe |
| Evidence | `admin-_print_preview_jobId-owner.png` (+ `-390.png`) |
| Defect | — |

### R-096 · `/printers` — **PASS**

| | |
|---|---|
| URL / role | `/printers` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Printers" |
| Functional test | PASS: Printers |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_printers-owner.png` (+ `-390.png`) |
| Defect | — |

### R-097 · `/promotions` — **PASS**

| | |
|---|---|
| URL / role | `/promotions` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Promotions" |
| Functional test | PASS: promotion listed |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_promotions-owner.png` (+ `-390.png`) |
| Defect | — |

### R-098 · `/register` — **PASS**

| | |
|---|---|
| URL / role | `/register` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Create your account" |
| Functional test | PASS: disabled until terms ticked; empty submit blocked (3 invalid fields) |
| Controls tested | PASS — 1 safe controls: a:Sign in |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_register-anon.png` (+ `-390.png`) |
| Defect | — |

### R-099 · `/reset-password` — **PASS**

| | |
|---|---|
| URL / role | `/reset-password?token=invalid-qa` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Set a new password" |
| Functional test | PASS: This reset link is invalid or has expired |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 400 POST /api/v1/auth/reset-password |
| Evidence | `admin-_reset_password-anon.png` (+ `-390.png`) |
| Defect | QA-014 fixed |

### R-100 · `/settings` — **PASS**

| | |
|---|---|
| URL / role | `/settings` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Settings" |
| Functional test | PASS: all tabs opened |
| Controls tested | PASS — 7 safe controls: button:General, button:Location, button:Ordering, button:Payment, button:Business Hours, button:Storefront, button:Domain |
| Form (empty submit) | PASS — blocked with message (submit "Save settings", native-invalid false, messages 2) |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — staff → /orders |
| Console / network | PASS |
| Evidence | `admin-_settings-owner.png` (+ `-390.png`) |
| Defect | QA-003, QA-005 fixed |

### R-101 · `/setup` — **PASS**

| | |
|---|---|
| URL / role | `/setup` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Wildwood Kitchen is ready to sell" |
| Functional test | PASS: Wildwood Kitchen is ready to sell |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_setup-owner.png` (+ `-390.png`) |
| Defect | — |

### R-102 · `/signup` — **PASS**

| | |
|---|---|
| URL / role | `/signup` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Start your free trial" |
| Functional test | PASS: empty step blocked |
| Controls tested | PASS — 1 safe controls: button:Continue |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_signup-anon.png` (+ `-390.png`) |
| Defect | — |

### R-103 · `/staff` — **PASS**

| | |
|---|---|
| URL / role | `/staff` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Staff" |
| Functional test | PASS: team listed |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_staff-owner.png` (+ `-390.png`) |
| Defect | NEW-3 (role change unaudited) — open |

### R-104 · `/start` — **PASS**

| | |
|---|---|
| URL / role | `/start` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Choose your plan" |
| Functional test | PASS: /start |
| Controls tested | PASS — 1 safe controls: button:Continue |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_start-anon.png` (+ `-390.png`) |
| Defect | — |

### R-105 · `/support` — **PASS**

| | |
|---|---|
| URL / role | `/support` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Support" |
| Functional test | PASS: Support |
| Controls tested | PASS — 2 safe controls: button:Contact support, a:Payment shows as unpaid after pickup TKT-1003 · Jordan Lee · |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_support-owner.png` (+ `-390.png`) |
| Defect | QA-006 fixed |

### R-106 · `/support/:id` — **PASS**

| | |
|---|---|
| URL / role | `/support/6aeff13926baf4f1c95b957b` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Payment shows as unpaid after pickup" |
| Functional test | PASS: Payment shows as unpaid after pickup |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: — |
| Console / network | PASS |
| Evidence | `admin-_support_id-owner.png` (+ `-390.png`) |
| Defect | QA-006 fixed |

### R-107 · `/tables` — **PASS**

| | |
|---|---|
| URL / role | `/tables` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Tables" |
| Functional test | PASS: QR shown |
| Controls tested | PASS — 1 safe controls: button:QR code |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_tables-owner.png` (+ `-390.png`) |
| Defect | — |

### R-108 · `/theme-studio` — **PASS**

| | |
|---|---|
| URL / role | `/theme-studio` · owner |
| Direct load | PASS |
| Rendering | PASS — h1 "Theme Studio" |
| Functional test | PASS: Theme Studio |
| Controls tested | PASS — 1 safe controls: button:Preview |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: PASS; wrong role: PASS — kitchen → /kitchen |
| Console / network | PASS |
| Evidence | `admin-_theme_studio-owner.png` (+ `-390.png`) |
| Defect | — |

### R-109 · `/verify-email` — **PASS**

| | |
|---|---|
| URL / role | `/verify-email?token=invalid-qa` · signed out |
| Direct load | PASS |
| Rendering | PASS — h1 "Verification failed" |
| Functional test | PASS: invalid token message |
| Controls tested | PASS — 0 safe controls |
| Form (empty submit) | N/A — no form |
| Refresh | PASS |
| Back/Forward | PASS |
| 390px | PASS |
| Access | signed-out: —; wrong role: — |
| Console / network | REVIEW (1 API 4xx, 1 console errors). API: 400 POST /api/v1/auth/verify-email |
| Evidence | `admin-_verify_email-anon.png` (+ `-390.png`) |
| Defect | — |

