# POS — Staff Terminal (Table Tents/POS Phase)

This documents the POS domain added this phase, and the decisions behind it, in the same spirit
as `docs/qr-dine-in-architecture.md` and `docs/operations-architecture-boundaries.md`.

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
`createdAt`, `channel: "pos"`, `paymentMethod`, and the staff member isn't currently recorded on
the order at all (a real gap for reconciliation, noted below) — but a first-class
open-shift/close-shift/reconcile workflow is future work.

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
- **Which staff member rang up a given POS order.** `Order` has no `createdByUserId`-style field;
  every order (online, dine-in, or POS) is only ever attributed to its `customerId`. For POS this
  is a real, known gap for reconciliation/accountability reporting — tracked here rather than
  silently absent, and additive to implement later (a new optional field, no migration required).
- **Discounts/voids/refunds initiated from the POS screen itself.** The existing manual
  paid/unpaid toggle and the existing order-status/cancellation flows apply to POS orders exactly
  as they do to any other order (they're the same `Order` model) — but POS has no bespoke "void
  this line" or "refund this sale" UI of its own this phase.
- **Entitlement-gating POS by plan** — see "Entitlements" above.
