# GarnishTable — Browser QA Summary (8 Nov 2026)

Full report: [`full-browser-qa-audit.md`](full-browser-qa-audit.md). Evidence: [`evidence/`](evidence/).

> **Update, 15 Nov 2026 — fixes on branch `fix/full-browser-qa-findings` (not merged or deployed):**
> - [`full-browser-qa-fixes.md`](full-browser-qa-fixes.md): 13 of 14 findings fixed and verified in the browser. QA-011's nginx change is unit-tested but wasn't run against a live nginx. The D-1 wording is corrected. Three new pre-existing issues were found; NEW-2 is fixed.
> - [`full-browser-all-pages-verification.md`](full-browser-all-pages-verification.md): all 109 routes re-tested route by route.
>
> The findings below are the original 8 Nov audit results, kept as recorded.

**Tested**
- **Production `4ffc99b`:** public pages only, read-only — no sign-in, submissions, orders or emails.
- **`main` `12d7238`:** on an isolated local stack with mock providers, for every signed-in and data-changing journey.
- **Marketing and storefront:** identical in both versions, so the production results also hold for `main`.
- **Screen sizes:** 1440, 1280, 768, 390 and 360px in Chromium.

## Coverage

| Routes discovered | PASS | FAIL | NOT TESTED | BLOCKED | N/A |
|---|---|---|---|---|---|
| 109 (16 marketing · 26 storefront · 67 admin) | 55 | 8 | 44 (29 rendered cleanly, not interacted with) | 1 (+6 blocked activities) | 1 |

## Bugs: 0 P0 · 0 P1 · 2 P2 · 12 P3

**P2**
- **QA-001:** a signed-out customer applying a promo code sees "Missing access token", and the code can't be used. Production.
- **QA-002:** the item dialog keeps showing the base price after a paid option is chosen ($16 shown, $18 charged). Production.

**P3**
- **QA-003:** admin pages first call `/restaurants/null/…` (403) on direct visits.
- **QA-004:** staff and kitchen accounts request plan entitlements on every page (403).
- **QA-005:** a blank-name save only says "Validation failed".
- **QA-006:** a platform admin can open the owner Support page, which errors.
- **QA-007:** a customer opening another customer's order sees "Forbidden".
- **QA-008:** the printed receipt logo is broken.
- **QA-009:** `order.garnishtable.com/` shows an unbranded page.
- **QA-010:** the `/v2` draft homepage is public.
- **QA-011:** the marketing 404 page returns HTTP 200.
- **QA-012:** a 401 console error on every signed-out page load.
- **QA-013:** storefront pages use a generic title.
- **QA-014:** mobile table layout rough spots.

## Journeys

| Journey | Result |
|---|---|
| Customer: browse → customise → cart → sign up → order → confirmation → history | **Works** (local). Production checked as far as the cart. |
| Delivery checkout (address search, radius, fee, promo) | **Works** (`geocoding-delivery` spec, 9/9) |
| Owner: sign in → menu → settings → hours → orders → staff → reports | **Works** |
| Platform admin: create restaurant → invite → plan lifecycle (offline, extend, change, suspend, cancel, resume, complimentary) → history and audit → reporting | **Works** |
| Agency: sign up → agency → client wizard → pages → isolation from other agencies | **Works** |
| Access control: 17 API probes, plus logout and redirects in the browser | **All correct** |
| Real payments, Uber Eats / Uber Direct / Stripe connect, real email | **Blocked**: needs provider accounts or staging |

## Risks to customer data, orders or payments
- **No data-exposure problem found.** Tenant, agency and customer isolation all held.
- **D-1 — card payments:** marketing promises card checkout on "your own Stripe account", but the production demo store offers **cash only**. Production's order-payment provider is believed to be `mock`. Confirm it, or soften the wording.
- **QA-002:** the price shown at add-to-cart can be lower than the price charged (the charge itself is correct).

## Not verified
- **Production signed-in areas:** no production credentials were used.
- **Production payment configuration:** reading production is blocked for me.
- **Real email delivery:** no emails were sent.
- **Provider flows:** connecting Lemon Squeezy, Stripe, Uber Eats, Uber Direct, DoorDash or foodpanda.
- **POS:** screens were opened, but the POS isn't enabled for the demo location.
- **Deeper testing:** no penetration test; no screen-reader or keyboard audit.
