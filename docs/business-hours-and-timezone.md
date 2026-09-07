# Business Hours, Timezone & Ordering Availability (Phase 51)

This documents the server-authoritative answer to "can this restaurant accept this order right
now," and how restaurant-local time is calculated everywhere it matters. It extends, and does not
replace, `docs/delivery-architecture.md` (eligibility/fee) and `docs/delivery-integrations.md`
(dispatch) — neither of those was touched this phase.

## What existed before this phase

- `Restaurant.settings.timezone` (an IANA string, e.g. `"America/Chicago"`, default `"UTC"`) and
  `Restaurant.settings.businessHours` (one `{day, isClosed, open?, close?}` entry per weekday,
  `"HH:mm"` 24h strings) already existed, already editable in the admin Settings page, and were
  already genuinely per-**location** — `Business` deliberately carries neither field (see its own
  doc comment: "nothing should force every location of a business onto one timezone or currency").
- `computeAvailability()` (`services/restaurantAvailability.service.ts`) was already the single,
  server-authoritative gate every order-creation path shared — but it only ever considered
  `orderingEnabled`/`temporarilyPaused`. Its own doc comment said so explicitly, and the admin UI's
  own "Business Hours" tab carried a banner admitting it: *"orders aren't automatically closed
  outside them."*
- `analytics.service.ts` (`timezoneAwareDayStart`, `getDailyTimeSeries`) and
  `packages/utils/src/datetime.ts` (`formatRestaurantTime`/`formatRestaurantDateTime`) were **already
  genuinely timezone-correct** — both convert UTC-stored instants into the restaurant's own IANA
  timezone (via MongoDB's `$dateTrunc`/`$dateToString` and `Intl.DateTimeFormat` respectively), and
  both already had DST-crossing proof in their own test suites. Neither needed a fix.
- No scheduled/future-order concept existed anywhere in the codebase (no field, no UI, nothing
  partially built). None was added this phase, per the brief's own explicit instruction.

The one real gap, exactly as the codebase's own `docs/roadmap.md` already admitted: **business
hours were stored and displayed but never enforced.**

## Hours model (unchanged schema)

One period per day, per location, stored on `Restaurant.settings.businessHours`:
`{ day: Weekday, isClosed: boolean, open?: "HH:mm", close?: "HH:mm" }`. No schema change was made —
the existing shape can correctly represent everything this phase needed:

- **Closed days**: `isClosed: true` (or a day simply absent from a non-empty array — treated as
  closed, the conservative reading of an incomplete admin configuration).
- **Overnight periods** (e.g. `open:"18:00", close:"02:00"`): already valid input (the Zod schema
  never required `close > open`) — just never correctly *evaluated* before this phase. Now
  interpreted as wrapping past midnight: the hours before midnight belong to the configured day,
  and the hours after midnight (until `close`) still count as that same period, regardless of what
  the *next* day's own hours say.
- **An empty/unconfigured `businessHours` array** (`[]`, the schema default — true of every
  restaurant that existed before this phase, and every new one that hasn't gotten to it yet) means
  **no hours-based restriction at all**, not "always closed." This is the deliberate
  backward-compatibility choice that makes this phase additive rather than a silent mass closure.

**Deliberately not built** (per the brief's own "do not automatically expand scope" instruction):
multiple periods per day (split shifts, e.g. separate lunch/dinner hours) and holiday-specific
exceptions. Both would need a real schema change; neither has a shipped product requirement behind
it today (the admin UI's own "Business Hours" tab already told owners this wasn't supported, before
and after this phase). Documented here as the honest limitation, not silently expanded.

## Timezone mechanism

No new dependency was added. `dayjs` is present in `node_modules` only as `exceljs`'s own
transitive dependency — it is not wired into this project anywhere and wasn't used here either.
Instead, this phase uses exactly the mechanism this codebase's own analytics/display code already
proved correct: `Intl.DateTimeFormat` with an explicit `timeZone`.

**New: `apps/api/src/services/businessHours.service.ts`** — pure, synchronous, deterministic (a
`now` instant is always explicit, defaulting to `new Date()`):

- `isWithinBusinessHours(businessHours, timezone, now?)` — decomposes `now` into the restaurant's
  local wall-clock weekday/hour/minute (`Intl.DateTimeFormat.formatToParts`), then checks both
  today's configured period and yesterday's (in case yesterday's period wraps past midnight into
  today).
- `getNextOpenAt(businessHours, timezone, now?)` — searches forward up to 8 calendar days for the
  next period start, converting that LOCAL wall-clock instant back to UTC via the standard
  guess-and-refine technique (`Intl.DateTimeFormat`'s `timeZoneName: "shortOffset"` gives the real
  UTC offset in effect near a guessed instant; refining twice converges for every real-world IANA
  zone except the sub-hour window exactly inside a DST transition itself — an acceptable, documented
  approximation for a "next opens at" display, not a legal/financial timestamp).

Every DST/overnight/multi-timezone claim in this document was verified against Node's own `Intl`
data before being written into a test fixture (2026's US spring-forward is March 8, fall-back is
November 1 — confirmed via `Intl.DateTimeFormat`, not assumed) — see
`businessHours.service.test.ts`.

## Availability logic (the one authoritative flow)

```
Restaurant.settings (businessHours, timezone, orderingEnabled, temporarilyPaused, pausedReason)
        ↓
computeAvailability(settings, now?)          [restaurantAvailability.service.ts]
        ↓  precedence, highest first:
        1. orderingEnabled:false            -> closed (indefinite kill switch, unchanged)
        2. temporarilyPaused                -> paused (manual override, unchanged, wins over hours)
        3. outside businessHours (Phase 51) -> closed, reason + nextOpenAt
        4. otherwise                        -> open
        ↓
createOrderForCustomer(...)                  [orderCreation.service.ts — the ONE order-creation
                                               path: online checkout, POS, delivery, pickup,
                                               dine-in all funnel through this one function]
        ↓ (unconditional, before any order-type branching)
closed/paused -> ApiError.badRequest(reason, { status, reason, nextOpenAt })
open          -> proceeds to order-type enablement, delivery eligibility, pricing, payment, etc.
                 (ALL UNCHANGED — see "What Phase 51 did not touch" below)
```

This is genuinely the only gate — verified by tracing every order-creation entry point
(`order.controller.ts`'s `createOrder`, `pos.controller.ts`'s `createPosOrder`, both calling
`orderCreation.service.ts`'s `createOrderForCustomer`) back to this one call. A direct API call
bypassing the storefront/POS UI entirely hits the exact same check — there is no second, weaker
path.

## Order-type behavior

Delivery, pickup, and dine-in are gated by the identical, unconditional hours check — none of them
can skip it. Hours answers "can an order be initiated at all"; each order type's own existing
requirements still apply on top (delivery eligibility/radius/fee — untouched; pickup/dine-in
enablement flags — untouched). **Scheduled orders do not exist in this product and were not added
this phase** — every order is still created and timestamped `now`, immediately.

## POS behavior

**POS is not exempt.** `pos.controller.ts`'s `createPosOrder` calls the exact same
`createOrderForCustomer` as online checkout, with the exact same hours gate — this was already true
of `orderingEnabled`/`temporarilyPaused` before this phase (no existing staff-override concept was
ever found in the codebase), so hours enforcement simply extends the same existing precedent rather
than inventing a new distinction. No POS code was changed. This was a deliberate choice per the
brief's own instruction not to invent an override without evidence it's required — if a restaurant
genuinely needs staff to ring up walk-ins outside its configured hours, the existing
`temporarilyPaused`/`orderingEnabled` flags don't offer that exemption either today, and adding one
specifically for hours (while leaving the other two flags un-exemptable) would be an inconsistent,
unrequested product decision, not a bug fix.

## Customer-facing display

`RestaurantAvailability` (the type every read-path response already returned) gained one additive
field: `nextOpenAt` (an ISO UTC instant, set only when `status:"closed"` because of hours).
**New: `packages/utils/src/describeAvailability(availability, timezone, now?)`** — the one shared
phrase-builder ("Open" / "{pausedReason}" / "Opens at 11:00 AM" / "Opens tomorrow at 11:00 AM" /
"Opens Wed, Jan 8 at 11:00 AM" for anything further out) — used by all 8 storefront themes' Hero
components (replacing each theme's own hardcoded "Closed right now"/"Closed" fallback with this one
call) and by the admin Settings page. Deliberately shows the **restaurant's own local time** for the
opening time, not the viewer's — a business's posted hours are a fact about its own clock, the same
way a physical storefront's hours sign is read in its own local time by any visitor.

**Also fixed while touching this code**: the 5 storefront themes that bold "today" in their hours
footer (`Footer.tsx` in contemporary/cinematic/minimal/urban/luxury) previously computed "today"
from the **viewer's own browser clock** (`new Date().getDay()`, evaluated once at module load,
never updated) — a visitor in a different timezone than the restaurant saw the wrong day bolded.
Now uses `getLocalWeekday(restaurant.settings.timezone)` (new, same file as `describeAvailability`),
computed fresh per render from the restaurant's own timezone. The other 3 themes (modern, editorial,
classic) don't render an hours list in their footer at all — untouched.

## Multi-location behavior

Each `Restaurant` document (= each location) carries its own `timezone`/`businessHours` and is
evaluated completely independently — proven by a dedicated test (`order.controller.test.ts`) placing
orders against two different restaurants with opposite hours-configured states in the same test,
confirming neither affects the other. `Business` still has no timezone field of its own (unchanged,
confirmed still the deliberate design it always was) — there is nothing to "fall back to" and
nothing that needed fixing here.

## Analytics/reporting

**No change was made** — `analytics.service.ts`'s `timezoneAwareDayStart`/`getDailyTimeSeries` and
`businessAnalytics.service.ts`'s per-location range analytics were already timezone-correct
(confirmed via their own existing DST-crossing tests) before this phase, and remain so. Business-wide
(multi-location) analytics deliberately uses an explicit calendar-date range rather than a shared
"today" across potentially-different timezones — already the documented, correct design (see
`docs/multi-tenant-storefront-architecture.md`'s own "Timezone safety" section), unchanged.

## Caching

**No availability caching exists, and none was added.** `menuCache.service.ts`'s 60-second TTL
covers menu items only, never `computeAvailability`'s result; `getRestaurantBySlug` and every other
read-path call site compute it fresh on every request. The one real staleness characteristic (not a
caching bug): the storefront fetches `availability` once on page load and does not poll — a visitor
who keeps a tab open across a closing boundary can see a stale "Open" badge until they navigate or
refresh. This is a pre-existing characteristic (true of `orderingEnabled`/`temporarilyPaused` before
this phase too, just less likely to matter since those change rarely) — the SERVER remains
authoritative regardless: an actual checkout attempt against stale client state is still correctly
rejected, with a clear reason, every time. Adding a polling mechanism to keep the display itself
fresher was judged out of scope (a real, unrequested complexity addition for a display-only
imperfection with no security/correctness consequence).

## Security

Every order-creation path (online, POS, delivery, pickup, dine-in) shares the identical
server-side gate — proven by tests hitting the HTTP API directly (bypassing any frontend) while a
restaurant is configured closed, for each order type, confirming rejection with a clear
`{status, reason, nextOpenAt}` detail payload. No authorization/tenant-scoping logic was touched.

## What Phase 51 did not touch

Delivery eligibility/radius/Haversine/fee calculation, the delivery-provider/dispatch architecture
(Phase 50), payment architecture, billing, pricing, email, monitoring, POS's own UI/architecture,
the admin portal's structure, storefront theme visual design, the Mongo/index architecture (Phase
49), or the `businessHours`/`timezone` schema shape itself.
