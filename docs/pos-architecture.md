# POS — Staff Terminal (Table Tents/POS Phase)

This documents the POS domain added this phase, and the decisions behind it, in the same spirit
as `docs/qr-dine-in-architecture.md` and `docs/operations-architecture-boundaries.md`.

## Update — Phase 75: operational recovery and staff accountability

Phase 74 shipped a real terminal-payment state machine but explicitly deferred two things: knowing
*which staff member* rang up a POS sale, and a way to recover a sale abandoned mid-payment (browser
closed, customer walked away, terminal declined and the cashier moved on). Phase 75 builds both,
reusing Phase 74's payment architecture completely unchanged — no second payment/state system, no
new terminal provider, no fake hardware.

**Creator attribution (`Order.createdByUserId`)**: a new, nullable `ObjectId` ref to `User`, set
exactly once, at creation, and never overwritten. `pos.controller.ts`'s `createPosOrder` passes
`createdByUserId: req.user!.id` — the authenticated staff member's own id from the verified session
— into `orderCreation.service.ts`'s `createOrderForCustomer` (the same one canonical path customer
checkout also uses; see below), which is the only place an `Order` document is ever built. It is
**never read from the request body**: `createPosOrderSchema` has no such field, so nothing a client
sends can spoof it — proven by a Jest test that POSTs a fabricated `createdByUserId` and asserts the
stored order still has the real, server-derived one. Customer checkout (`channel: "online"`) never
passes this parameter, so online orders correctly have no creator — this is a staff-only concept,
not a general "who placed this order" field (`customerId` already answers that, for every channel).
Every pre-Phase-75 order is implicitly, correctly unset — no backfill, no migration.

`createdByName` (resolved server-side from `createdByUserId`, batched into the same lookup
`withCustomerInfo` already does for `customerName`) is staff-only, internal information — both
fields are stripped by `stripInternalFields` from any customer-facing response, the same treatment
`internalNote` already got.

**Pending Sales** (`GET /restaurants/:id/pos/pending-sales`, `apps/admin/src/pos/PendingSalesPage.tsx`,
nav item "Pending"): a dedicated, actionable recovery surface — deliberately separate from the
existing read-only Orders list — showing exactly the POS orders that are recoverable: `channel:
"pos"`, `paymentStatus: "unpaid"`, `status` not `"cancelled"`. A completed sale or a genuinely
cancelled one simply isn't "pending" anymore and correctly disappears from this list on its own;
nothing here auto-cancels anything based on age (the brief was explicit that age-based
auto-cancellation needs a real business rule this phase has no basis for) — instead, age is made
*visible* (`formatElapsed`, the same "3m"/"1h 12m" convention `KitchenPage` already established) so
a stale sale is obvious to whoever is looking, without the system silently acting on it. Each row
also shows order number, order type/table, customer name (or "Walk-in"), total, payment-state badge,
and "Started by you" / "Started by {name}".

**Resume, not rebuild**: resuming a pending sale does not reopen cart-editing — the order's items
are already finalized and server-priced. "Resume" hands the existing `Order` object straight to
`PaymentConfirmation`/`TerminalCardPayment` via React Router state
(`navigate("/pos", { state: { resumeOrder } })`), the exact same handoff idiom `RegisterPage.tsx`
already used for `handoffCustomer`. This is why **zero changes were needed in
`PaymentConfirmation.tsx` or `TerminalCardPayment.tsx`** — Phase 74's terminal abstraction is
untouched, satisfying the brief's explicit "do not modify unless a real defect is found" constraint
in full. `RegisterPage.tsx` only reorders its own render logic so a resumed sale's payment screen
renders before the (irrelevant, for a resume) menu/tables loading check.

**Recovery is authorization-checked, not just UI-hidden.** Any staff member holding
`restaurant.pos.operate` at the location can resume or cancel *any* pending sale there — not only
its creator. This deliberately matches existing precedent: nowhere else in this codebase does
`restaurant.orders.manage`/`restaurant.pos.operate` narrow to "only orders you personally created" —
a manager can already edit/cancel any order at their location today. Inventing a creator-restricted
tier just for Pending Sales would be a new, inconsistent rule with no requirement driving it. What
Phase 75 *does* add is transparency: the UI always names the original creator ("Started by X"), so
recovering someone else's sale is visible, informed, and auditable after the fact via
`createdByUserId` — the authorization boundary is tenant/location scope (server-verified,
see below), same as it already was.

**"Created by" is never "recovered by."** No new field was added for who *resumed* or *completed*
a sale after its creator stepped away. `createdByUserId` is written once and never touched again —
Staff A's abandoned sale, resumed and completed by Staff B, still shows `createdByUserId` = Staff A
after payment succeeds (verified by both a Jest test and the Playwright staff-switching scenario).
"Recovering staff member" is not a stored concept at all — it's simply whoever is authenticated in
the session that acts on the sale next; the existing session/auth model already answers that
question without a new column. This was a deliberate decision, not an oversight: the brief asked
whether a "recovered by" field was genuinely required, and it is not — nothing in this phase's scope
(reporting, accountability, staff switching) needs to reconstruct "who touched this sale in what
order" beyond what `Order.statusHistory` and normal request logging already capture.

**Staff switching interacts correctly with pending sales**, because it was never given a special
case: `LockScreen`'s "Switch staff member" is (unchanged, Phase 73) just a normal `AuthContext.login()`
call for a different account. A locked/unlocked/switched terminal has no relationship to any
particular `Order` document at all — pending sales live in the database, keyed to the restaurant and
their own `createdByUserId`, completely independent of which staff member's session happens to be
active in the browser at any moment. There was no code path to fix here; this is a property that
falls out for free from creator attribution being a durable database field rather than any kind of
session or client state.

**Terminal setting UI** (`SettingsPage.tsx`, "Ordering" tab, "Point of sale" fieldset, new "Card
terminal" sub-section): the Settings UI Phase 74 explicitly deferred ("nothing real to configure
without a real provider"). Two independent facts, never conflated: a `Badge` reports whether *this
deployment* has any terminal capability at all (`restaurant.posTerminalProviderConfigured`, computed
server-side from `env.POS_TERMINAL_PROVIDER !== "none"` — a platform-level fact this page can only
report, never change) — "Provider available" or "Not configured"; a checkbox, shown only when a
provider *is* configured, controls whether *this location* has opted in
(`restaurant.settings.posTerminalEnabled`), with copy explicitly noting it's per-location. When no
provider is configured, the checkbox is replaced with explanatory text — never a fake provider
picker (there is exactly one provider, the dev/test-only mock, and pretending otherwise would be
exactly the kind of fabricated capability the brief prohibits). The server-side two-gate check inside
`posTerminalPayment.service.ts` (deployment configured AND location enabled) is completely unchanged
from Phase 74 — this phase only ever added a way to *see and set* the location half of a check that
already existed and was already enforced.

**A real, pre-existing gap this phase found and fixed**: `packages/validation/src/restaurant.ts`'s
`restaurantSettingsSchema` — the zod schema `updateRestaurantSchema.settings` validates against, and
whose own doc comment says "anything not listed here is stripped by zod" — never listed
`posTerminalEnabled`, even though the field existed on the `Restaurant` model since Phase 74. Because
there was no Settings UI before this phase, nothing had ever actually tried to set it through the
real update-restaurant endpoint (Phase 74's own Playwright spec sets it directly via Mongo, its
documented exception for fields with no UI yet) — so the gap was silent. The new Settings checkbox
this phase built would have saved *nothing at all*: the box would appear to toggle, "Saved." would
show, and the location's actual `posTerminalEnabled` would never change. Caught by this phase's own
Playwright coverage (the "Start card payment" button never appeared after enabling the setting
through the UI) before it could ship silently broken. Fixed with one line
(`posTerminalEnabled: z.boolean().optional()` alongside the pre-existing `posEnabled`), covered by a
dedicated Jest test asserting the setting round-trips through the real endpoint in both directions.

**Idle lock** (`POSLayout.tsx`): an optional auto-lock timeout — Off (default) / 5 / 10 / 15 / 30
minutes — stored in `localStorage` (`pos.idleTimeoutMinutes`), deliberately **not** a
`Restaurant.settings` field. This is a device-level UX safety preference ("how long before *this
screen* locks itself"), not a business policy needing multi-device sync, and a server-side field here
would edge toward the persistent terminal/device-identity entity Phase 73 and 74 already
independently declined to invent. Real mouse/keyboard/touch activity
(`mousemove`/`keydown`/`touchstart`/`click`, passive listeners) resets a timer; firing it calls the
existing `setLocked(true)` — **zero changes to `LockScreen.tsx`**. The idle-detection effect is
explicitly disabled while already locked (nothing useful for it to track on an inert screen) and,
critically, locking only ever mounts the `LockScreen` overlay *alongside* the existing register tree
(`inert`, not unmounted) — so an in-flight terminal-payment poll in `TerminalCardPayment` keeps
running underneath exactly as it did for the pre-existing manual Lock button, and unlocking reveals
the *same* in-flight payment, never a fresh, payment-less register. Verified end to end by a
Playwright test that starts a terminal payment, locks, unlocks, and completes the same payment.

**Access control on every new endpoint**: `GET .../pos/pending-sales` is registered under the
existing `posRouter`, inheriting its `requireAuth` + `requireTenantMatch()` +
`requirePermission("restaurant.pos.operate")` chain unchanged — no new permission was introduced.
Covered by tests for: unauthenticated (401), `kitchen_staff` (403, lacks the permission), a
different restaurant's owner (403, tenant isolation), and a staff member scoped only to a different
location attempting the same restaurant's URL (403) — the location/tenant boundary is enforced
identically to every other POS route, never inferred from anything the client sends.

**Order/payment invariants — two real gaps found and closed.** Auditing Part 11's explicit
invariant ("a cancelled sale must never become paid") against the actual code turned up two
previously-unguarded paths, both now fixed with a minimal, targeted check:
1. `order.controller.ts`'s `updateOrderPaymentStatus` — now rejects marking a `"cancelled"` order
   `"paid"` (400), closing the manual/cash path.
2. `posTerminalPayment.service.ts`'s `createPosTerminalPayment` — now rejects starting a new
   terminal-payment attempt against a `"cancelled"` order (400), closing the terminal path.

Both are covered by Jest tests that assert not just the rejection, but the actual invariant: the
order's stored `paymentStatus` never flips, and — for the terminal path — zero `Payment` documents
are ever created for a cancelled order, regardless of how the request was made.

## Update — Phase 74: terminal-ready payment architecture

Phase 73 left card payment as an explicit staff-attestation step ("Payment approved" — staff
confirming a *separate* physical card machine already charged the customer, this software
confirming nothing itself). That decision was correct and remains correct: no real terminal
hardware, provider account, or credentials exist in this environment, and Phase 74 does not fake
any of them. What Phase 74 adds is the architecture a real terminal integration would plug into,
built and verified against a clearly-fake, dev/test-only adapter — never presented as production
capability.

**The state machine already existed — it was reused, not invented.** `Payment`
(`apps/api/src/models/Payment.ts`) already had exactly the vocabulary a terminal needs — `pending
-> requires_action -> authorized -> paid | failed | cancelled` — built for online payments, with a
real idempotency-key unique index, a partial unique index enforcing one `paid` Payment per order,
and an atomic transition path (`payment.service.ts`'s `applyPaymentStatusTransition`, now exported
for reuse). Phase 74 does not introduce a second payment/state system: `Payment.PAYMENT_METHODS`
gained one new value, `"pos_terminal"`, and a terminal payment is a genuinely real `Payment`
document, sharing every guarantee an online payment already has.

**Provider boundary** (`apps/api/src/payments/terminal/`): `PaymentTerminalProvider` is a new
interface, deliberately a sibling of `../PaymentProvider.ts` rather than a variant of it — a
terminal has no hosted-checkout redirect/`clientSecret` and is driven by polling
(`retrieve()`) rather than necessarily a webhook, but reuses the identical status vocabulary.
`MockTerminalProvider` is the only implementation, and is unreachable in any deployment unless
`env.POS_TERMINAL_PROVIDER` is explicitly set to `"mock"` (default: `"none"` — see env.ts's own
comment for why the default here is "no capability," not "mock," unlike `PAYMENT_PROVIDER`). No
real provider (Stripe Terminal or otherwise) is implemented — see
`docs/payment-provider-decision.md`'s Phase 74 section for exactly what one would require and why
none is safe to build without a real account/hardware/market decision.

**Two independent opt-ins gate the whole flow**, checked server-side before ever touching the
provider (`posTerminalPayment.service.ts`'s `createPosTerminalPayment`), mirroring `posEnabled`'s
own precedent exactly:
1. `env.POS_TERMINAL_PROVIDER !== "none"` — does this *deployment* have any terminal capability at
   all.
2. `Restaurant.settings.posTerminalEnabled` — has this *location* opted in. No Settings UI exists
   for this yet (there is nothing real to configure without a real provider) — tests set it
   directly via Mongo, the same documented exception this project's other e2e specs already use
   for fields with no UI affordance yet.

Neither factor is inferred from the other or trusted from the client; both are independent of
`posEnabled` (a location can run cash/staff-attested-card POS with no terminal opt-in at all — the
default, everywhere).

**Endpoints** (all under the existing `posRouter`, inheriting its `requireTenantMatch()` +
`restaurant.pos.operate` gate — no new permission):
- `POST /restaurants/:id/pos/orders/:orderId/terminal-payment` — create/reuse an attempt
  (idempotency-keyed, exactly like the online `createPaymentForOrder`; also reuses any still
  in-flight attempt on the same order regardless of key, so a re-render/duplicate submit can never
  start a second concurrent terminal request).
- `GET .../terminal-payment/:paymentId` — polled on-demand by the frontend while showing a live
  waiting/processing state (not only a background job); asks the provider for its current status
  and applies any real change through the same atomic path a webhook would use.
- `POST .../terminal-payment/:paymentId/cancel` — staff-initiated cancellation of a still-in-flight
  attempt, always available regardless of provider (a real terminal SDK's own "stop prompting the
  customer" call is not a test-only capability).
- `POST .../terminal-payment/:paymentId/mock-complete` — dev/test-only, registered only when
  `POS_TERMINAL_PROVIDER=mock`, mirroring `payment.routes.ts`'s own online mock-complete route
  exactly (a route that does not exist at all otherwise, so it can never be mistaken for a real
  confirmation).

**Frontend** (`apps/admin/src/pos/components/TerminalCardPayment.tsx`): rendered by
`PaymentConfirmation.tsx` only when both opt-ins above hold for the active location; every other
environment keeps Phase 73's card UI completely unchanged. States: idle (confirm amount, "Start
card payment") -> creating -> waiting (`requires_action`/`pending`, "Waiting for card...") ->
processing (`authorized`) -> paid (hands off to `CompletedSale`, no separate "mark paid" step
needed — the terminal payment reaching "paid" already set `Order.paymentStatus` server-side) |
declined | cancelled | timeout (client-side: 45s with no resolution, the underlying payment is left
exactly as-is server-side) | error. "Cancel sale" — from idle, from any failure state, or from an
in-flight "Cancel payment" — always also cancels the underlying Order (`PATCH .../status`), never
just abandons it: a real bug found during this phase's own Playwright testing (staff cancelling a
declined/timed-out terminal sale left the order silently `pending` forever, invisible to the
cashier who'd already been returned to a fresh register) — fixed before this phase closed.

**What was deliberately NOT built**: any real provider adapter (Stripe Terminal or otherwise —
requires a real account, hardware, and a market decision this phase has no basis to make); a
Settings UI for `posTerminalEnabled` (nothing real to configure yet — **built in Phase 75**, see
above); a persistent Terminal/Register device-identity entity (re-evaluated this phase — still not
justified, see below); a "pending sales" resume surface (evaluated, deliberately deferred — see
below, a genuinely separate, larger piece of work — **built in Phase 75**, see above).

**Terminal/Register identity — re-evaluated, decision unchanged.** Phase 73 already declined to
build a persistent "Register 1 / Front Counter" concept for its own sake. Phase 74 revisited this
specifically for terminal-payment routing (a real terminal integration eventually needs to know
*which physical device* to send a request to) and still found no justification for a new entity:
today there is exactly one (mock) provider and no multi-device routing requirement — `Restaurant`
(location) is the only scope a terminal payment needs, which is also the unit every other tenant
check in this codebase already uses. If a real integration later needs multiple physical devices
per location (e.g., "Front Counter" vs. "Bar" terminals, mirroring `Printer.purpose`'s existing
per-purpose routing), that is an additive field/model at that point, driven by that integration's
real requirements — not invented speculatively now.

**Pending POS sales — evaluated, deliberately deferred at the time, not a silent gap.** An order
can still end up `pending`/unpaid if a browser closes mid-sale (Phase 73's own documented weakness)
— Phase 74's new terminal flow did not make this worse (a cancelled/abandoned terminal attempt
correctly cancels its order too, per the fix above) but did not build a "resume pending sale"
surface either, pending the product decisions this phase lacked a basis for (which staff can resume
another staff member's abandoned sale? does the existing Orders page's manual paid/cancel toggle
already cover the recovery need well enough?). **Phase 75 made those decisions and built the
surface** — see the Phase 75 section above for the resolved answers (any authorized POS operator can
resume/cancel any pending sale at their location; a dedicated Pending Sales page, not just the
existing Orders page, is the real recovery path now) and the full design.

## Update — Phase 73: direct staff access, lock/switch, and payment confirmation

Phase 73's brief asked whether a staff member can genuinely open the POS URL in a fresh browser,
sign in, and land on the register — without an Owner Portal detour — before implementing anything.
The audit found the POS *shell itself* (`POSLayout`, its own nav rail, its own permission gate) was
already exactly what the brief asked for, but the **auth redirect underneath it was not**:
`RequireAuth` bounced an unauthenticated visit to `/login` with no memory of where they'd been
headed, and `LoginPage` always sent every restaurant-role account to a fixed role-home page
(`DashboardPage`, which itself redirects `restaurant_staff` on to `/orders`) — never back to
`/pos`. A staff member bookmarking or being handed the POS URL directly always landed on Orders
Management, not the register, after signing in. Fixed by the standard React Router pattern:
`RequireAuth` now passes the original path via `location.state.from` when it redirects to
`/login`, and `LoginPage` returns there post-login if present, falling back to the existing
role-home logic otherwise. Purely a client-side UX return-path — `RequireAuth`'s own permission
check still runs identically on the destination either way, so this cannot grant access to
anything a role couldn't already reach.

**Lock / switch staff member (Section 9)**: confirmed, via a repo-wide search, that no
lock-screen/PIN/idle-timeout mechanism existed anywhere in this codebase before this phase. Built
the smallest secure version rather than a new PIN system: a "Lock" button in `POSLayout`'s header
sets a `locked` flag (persisted in `sessionStorage` only — a locked terminal demands re-auth again
after the browser tab itself is closed and reopened, but needs no separate "remember to lock it"
mechanism of its own) and renders `LockScreen` as a blocking overlay (`inert` on the register
underneath). Unlocking, and handing the terminal to a *different* staff member, are both just a
call to the exact same `AuthContext.login()` `LoginPage` uses — no new backend endpoint, no PIN
storage of any kind, no second place a credential is verified. The terminal's location/business
context re-resolves automatically for whoever logs in (`LocationContext` already keys off the
authenticated user, unchanged).

**Terminal/Register identity (Section 8) — decision: not built, and here is why.** Evaluated
whether a persistent "Register 1" / "Front Counter" / "Bar" entity is needed. It is not, for this
phase: every POS order is already correctly scoped to a *location* (a `Restaurant` document,
enforced server-side by `requireTenantMatch`), which is the unit every other part of this
platform's tenant model uses — inventing a second, finer-grained "which physical terminal" concept
with no concrete requirement driving its shape (reporting? routing? access control?) would be
exactly the speculative complexity `docs/operations-architecture-boundaries.md` already established
this codebase avoids. The one place a "which physical station" concept is genuinely needed —
routing a kitchen ticket to the kitchen printer and a receipt to the front-counter printer, not
"which POS device rang it up" — already exists and is the right level: `Printer.purpose`
(`receipt` | `kitchen` | `bar`), per `docs/pos-printer-architecture.md`. If a real future
requirement emerges (shift reporting, e.g. "which register took this order"), the existing
`docs/pos-architecture.md`'s own "What was deliberately NOT built" section already tracks the
closest related gap (`Order` has no `createdByUserId` today) — a `terminalId` would be the same
shape of additive, non-breaking field, not a reason to build a whole entity speculatively now.

**Payment confirmation (Sections 10–14, 31)**: `createPosOrder` now always receives
`markPaidImmediately: false` from the register (`RegisterPage.tsx`), where it previously defaulted
to `true` (`createPosOrderSchema`) for both cash and card — meaning tapping "Take cash"/"Charge
card" instantly marked the sale paid with zero further confirmation, for either method. The new
`PaymentConfirmation` step (rendered between order-creation and `CompletedSale`) requires an
explicit action before the existing `PATCH .../orders/:id/payment-status` is called: for cash, a
real received-amount input with a live change-due calculation, disabled until the amount actually
covers the server-computed `order.total`; for card, an explicit "Payment approved" attestation
(the honest framing — see `docs/payment-provider-decision.md`'s Phase 73 update for why no real
terminal confirms this yet) instead of an unconfirmed instant-paid tap. Declining/cancelling either
path cancels the still-`pending`/unpaid order (`PATCH .../orders/:id/status`, `"cancelled"` is
always a valid transition out of `"pending"`) rather than abandoning it silently. No new backend
endpoint was added for any of this — every request was already a real, existing capability.

## What "POS" means here — and what it deliberately doesn't

`docs/operations-architecture-boundaries.md` (Phase 6) already investigated "POS" once and
correctly declined to build it — but that was about **third-party hardware/vendor POS
integration** (a physical Square/Toast/Clover terminal, or this platform pushing data out to one).
That question is genuinely unchanged and still unanswered (which vendor, which protocol — entirely
speculative without a real integration target), and this phase does not touch it.

What this phase builds instead is a **first-party staff terminal**: an in-app screen
(`apps/admin/src/pages/PosPage.tsx`, route `/pos`) where a restaurant's own staff ring up a
walk-in/phone/counter sale — browse the real menu, build a real cart, pick a real customer,
collect cash or card, and create a real `Order` through the exact same pipeline the customer-facing
checkout uses. No physical terminal, printer, or cash-drawer hardware is claimed or integrated.

## One canonical order-creation path

`order.controller.ts`'s `createOrder` (customer checkout) and the new `pos.controller.ts`'s
`createPosOrder` (staff terminal) both call `services/orderCreation.service.ts`'s
`createOrderForCustomer` — the entire body of the old `createOrder` (availability checks, settings
gates, delivery eligibility, server-authoritative pricing via `priceOrderItems`, promo/loyalty
handling, the single DB transaction, the emitted `order.created` event), extracted verbatim and
unchanged. Callers differ only in:

- How `customerId` is obtained (the authenticated customer's own id, vs. a staff-resolved one —
  see "Walk-in customers" below).
- How a dine-in order's table is resolved (`tableToken`, re-validated from an untrusted QR scan,
  vs. `tableId`, trusted directly — see "Table trust model" below).
- `channel` (`"online"` vs `"pos"`) and, for POS only, `markPaidImmediately`.

Nothing about pricing, availability, delivery, promo, or loyalty logic exists twice.

## Order model additions

- **`Order.paymentMethod`** gains `"card"`, alongside the existing `"cash"`/`"online"`. This
  platform has no live card-terminal integration (see above), so a card payment collected at the
  register is, from this system's point of view, identical to cash: staff confirms it happened,
  nothing is charged or refunded through this app. `updateOrderPaymentStatus` already generalized
  to "any non-online method" and needed **zero changes** to support it.
- **`Order.channel`**: `"online" | "pos"`, defaulting to `"online"`. Orthogonal to `orderType` — a
  dine-in order can be self-ordered via QR (`"online"`) or rung up by staff for a walk-in table
  (`"pos"`). Every pre-POS order is correctly, implicitly `"online"` with zero migration. Surfaced
  as a small "· POS" marker on `OrdersManagementPage` next to the existing dine-in "Table N"
  marker, so an owner sees online, dine-in, and POS orders converge into one operational list — not
  three disconnected systems.

## Walk-in customers

Every `Order` requires a real `customerId` (unchanged) — POS has no logged-in customer session to
derive one from, so `services/posCustomer.service.ts`'s `resolvePosCustomerId` resolves one of two
ways, chosen by the staff terminal's UI:

1. **An existing customer** — staff search `GET /restaurants/:id/customers?search=` (now also
   matching phone, not just name/email — walk-ins are usually searched for by phone) and pick a
   result; the POS request then carries `{customerId}`, re-verified server-side (exists, `role:
   "customer"`, not deleted) before use — a client-supplied id is never trusted on its own, same
   discipline as every other id this codebase accepts off the wire.
2. **A new walk-in** — `{name, phone?, email?}`. If the given email already belongs to a real
   customer, that account is reused (so the same person's history stays connected across visits)
   rather than creating a duplicate. Otherwise a genuinely new `User` (`role: "customer"`) is
   created — **not** `isDemoAccount: true`. That flag means something specific and different (a
   throwaway public-marketing-playground session, excluded from real analytics/customer lists); a
   walk-in POS sale is real revenue and must show up everywhere a normal customer's does. A
   synthetic, obviously-non-deliverable `@pos.local` email is generated only when none is given
   (the `User` schema requires one), and a random, never-usable password is set — the same pattern
   `auth.controller.ts`'s `startDemoSession` already established, minus the demo flag.

## Table trust model — staff-selected, not QR-scanned

The customer-facing flow resolves a dine-in table from an opaque `tableToken` (whatever the QR
scan produced), re-validated from scratch because an anonymous customer's browser is never
trusted. POS is different: staff are already authenticated, tenant-matched
(`requireTenantMatch()`), and hold `restaurant.pos.operate` — the same trust level every other
staff-only tenant-scoped write in this codebase relies on. So POS instead sends a `tableId`
directly (chosen from the restaurant's own table list, `GET /restaurants/:id/tables`), which
`createOrderForCustomer` still re-checks against `{ _id: tableId, restaurantId, isActive: true }`
— scoped to the calling restaurant, exactly like every other tenant-scoped lookup — but does not
require a QR round-trip for a staff member standing at the table.

## Payment

POS supports exactly two methods, both staff-collected and immediately recordable:

- **Cash** — the pre-existing lifecycle, unchanged.
- **Card** — new (see above), functionally identical to cash in this system.

**Deliberately not offered**: `"online"`. Online payment is the customer's own hosted/redirect
checkout session tied to their own browser session; there is no sensible way for a staff terminal
to trigger that on a customer's behalf, so pretending POS "supports" it would be exactly the kind
of fake capability this phase was told not to build.

`markPaidImmediately` (POS request only, default `true`) creates the order already `paymentStatus:
"paid"` in the same transaction — staff collect payment in the same motion as ringing up the sale,
so a second `PATCH .../payment-status` round trip isn't needed for the common case. Settable to
`false` for a restaurant that wants to tab a dine-in order and settle later; the existing manual
mark-paid endpoint still works on it exactly as it always has.

## Receipts

No new receipt UI was built. `apps/admin/src/pages/PrintOrderPage.tsx` (Phase 14's existing
printable receipt/kitchen-ticket view, `GET /orders/:id` → browser print) already works for any
order a staff member with `restaurant.orders.read` can see — which every POS order is, being a
normal `Order` document. The only change here was fixing its payment-method label, which
previously assumed every non-online order was cash; it now distinguishes "Cash" from "Card".

## Authorization

New permission: **`restaurant.pos.operate`**. Granted to `restaurant_owner`, `restaurant_manager`,
and `restaurant_staff` — the roles that actually run a register — deliberately **not**
`kitchen_staff` (kitchen doesn't ring up sales) and not the platform/agency-owner-only tier beyond
what `restaurant.tables.manage` already uses as its precedent. Agency roles get the equivalent
grant via `AGENCY_ROLE_GRANTS` (`agency_owner`/`agency_admin`, mirroring `restaurant.tables.manage`
exactly; `agency_staff` does not, matching its existing read-mostly scope).

**Opt-in, off by default**: `Restaurant.settings.posEnabled` defaults to `false`, the same
opt-in-off-by-default pattern as `dineInEnabled`/`kitchenEnabled`/`staffEnabled`. A restaurant must
explicitly turn the POS terminal on before `restaurant.pos.operate`-permitted staff can use it —
checked independently server-side (`POST .../pos/orders`), not just as a nav-hiding flag.

**Tenant isolation**: every POS route requires `requireTenantMatch()` alongside
`requirePermission("restaurant.pos.operate")`, identical to every other restaurant-scoped staff
route — a staff member for restaurant A can never create, or even attempt to associate a table
for, restaurant B through this endpoint.

## Entitlements — deliberately ungated, matching existing precedent

`services/entitlement.service.ts`'s own doc comment already establishes the precedent this phase
follows: entitlements are a real, seeded mechanism but **not yet wired into any existing route's
authorization chain**, "per the brief's explicit instruction not to prematurely gate existing
features merely because the architecture now makes it possible." Dine-in/tables and business
analytics/promotions are all real, shipped features that work identically on every plan today. POS
follows the same rule: available to any restaurant whose staff hold the permission and whose
location has `posEnabled` on, with no plan-tier check. If/when a commercial decision is made to
restrict POS to specific plans, `hasEntitlement(plan, "pos")` is a one-line addition to
`pos.controller.ts`'s `createPosOrder` — the mechanism already exists, this phase just doesn't
invent the pricing decision it would require.

## Shift / cash-drawer reconciliation — explicitly deferred

Not built this phase, and this is a deliberate scope decision, not an oversight.
`operations-architecture-boundaries.md` already established this codebase's standard for exactly
this situation: don't build speculative complexity ("full accounting") without a concrete
requirement driving its shape. A real shift/reconciliation system needs product decisions this
phase has no basis for (per-terminal or per-staff-member shifts? what counts as a discrepancy? does
a manager close someone else's shift?) that are genuinely unanswered, not merely unbuilt. What
exists today is enough to reconstruct shift-equivalent reporting after the fact — every `Order` has
`createdAt`, `channel: "pos"`, `paymentMethod`, and (as of Phase 75) `createdByUserId` — but a
first-class open-shift/close-shift/reconcile workflow, and any UI that aggregates sales-by-staff or
cash-accountability reporting from that data, remains future work. Phase 75 deliberately built only
the attribution field itself, not a reporting surface on top of it — see that phase's own section
above for why.

## Real-time

No new real-time code. POS orders are ordinary `Order` documents created through the same
`emitOrderEvent("order.created", ...)` call every other order-creation path already uses — they
arrive in `apps/admin`'s existing `restaurant:{id}` Socket.IO room and show up on
`OrdersManagementPage`/`KitchenPage` exactly like an online or QR dine-in order does, with the new
"· POS" marker distinguishing the channel where it's useful (Orders) and no marker where it isn't
(Kitchen doesn't need to know which channel an order came from to prepare it).

## What was deliberately NOT built this phase

- **Physical POS/terminal/printer/cash-drawer hardware integration** — unchanged from Phase 6's
  conclusion; still correctly speculative without a real vendor target.
- **Shift/cash-drawer reconciliation** — see above.
- **Which staff member rang up a given POS order.** *(Resolved in Phase 75 —
  `Order.createdByUserId`; see the Phase 75 section above.)* At the time this phase shipped, `Order`
  had no such field; every order (online, dine-in, or POS) was only ever attributed to its
  `customerId`. Tracked here rather than silently absent, and implemented later exactly as
  additively as anticipated: a new optional field, no migration required.
- **Discounts/voids/refunds initiated from the POS screen itself.** The existing manual
  paid/unpaid toggle and the existing order-status/cancellation flows apply to POS orders exactly
  as they do to any other order (they're the same `Order` model) — but POS has no bespoke "void
  this line" or "refund this sale" UI of its own this phase.
- **Entitlement-gating POS by plan** — see "Entitlements" above.
