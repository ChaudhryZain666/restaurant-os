# Operations Architecture Boundaries (Phase 6)

Two capabilities were investigated this phase, deliberately not built, and are documented here so
the decision (and why) survives rather than being re-litigated from scratch later.

## Kitchen stations (Part 15)

**Decision: not built. No schema change made for it.**

The question was whether `Category` (Pizza, Burgers, Salad, ...) could double as a kitchen
station (Grill, Drinks, Desserts) for routing KDS items to the right physical prep area. It
can't, cleanly — those are two different axes:

- `Category` is a **menu-organization** concept (how items are grouped for customers browsing
  the storefront).
- A "station" is an **operational-routing** concept (which physical kitchen area preps an item).

In this restaurant's real seed data, "Pizza" (menu category) and "the pizza oven" (station) are
almost the same thing — but that's a coincidence of this one restaurant's floor plan, not a rule.
A restaurant elsewhere might put "Kids Menu" as a category spanning items actually prepared at
three different stations (grill, fryer, drinks). Conflating the two would mean every restaurant's
menu categorization is silently constrained by their kitchen layout, or vice versa.

**What a real implementation would need:**

1. A new, separate `station` concept — most naturally a field on `MenuItem` (`stationId?`) or a
   small `Station` collection per restaurant (`{ restaurantId, name, sortOrder }`) if restaurants
   need to name/reorder their own stations, not a field on `Category`.
2. `KitchenPage` (`apps/admin/src/pages/KitchenPage.tsx`) would group/filter items-within-orders
   by station instead of (or in addition to) the current single-board-per-restaurant view — this
   only affects the KDS rendering, not the order/payment domain underneath it.
3. A decision on granularity: is routing per-item (a burger order routes its patty to grill and
   its drink to the drinks station separately) or per-order (whole order goes to one station)?
   Real kitchens do both depending on size — this needs a product decision, not an assumption.

None of this was built because doing it without settling (3) would mean guessing at a business
rule. The KDS built this phase deliberately shows the whole order as one unit, which is correct
today (single-station-equivalent kitchens) and doesn't block adding per-item station routing later
— `OrderItem` already exists as the natural place to eventually hang a `stationId` off of.

## Hardware integration: receipt/kitchen printers, POS (Part 18)

**Decision: not built. No integration framework added.**

Investigated whether the current architecture could eventually support physical receipt/kitchen
printers or POS systems, without building the integration itself.

**What already fits the shape this would need**, without any change:

- `emitOrderEvent` (`apps/api/src/events/orderEvents.ts`) already fires a well-defined event per
  order-lifecycle transition (`order.created`, `order.confirmed`, ...), consumed today by
  Socket.IO push and a BullMQ notification queue job. A print dispatcher is architecturally
  identical to those two existing consumers: a third listener registered in
  `registerOrderEventListeners` that, on `order.confirmed`, sends the order to a printer instead
  of (or alongside) a socket push.
- The BullMQ `notifications` queue already accepts arbitrary job payloads keyed by event type —
  a `kitchen.print` job could be enqueued the same way `order.confirmed` jobs are today.

**What's deliberately not decided or built:**

- Which physical protocol (ESC/POS over network, a cloud print-relay service like PrintNode/Star
  CloudPRNT, a local USB bridge app) — this is entirely dependent on which real printer hardware a
  restaurant owns, which isn't knowable in the abstract.
- Whether printing is platform-hosted (this backend talks to a cloud print API) or requires a
  restaurant-side agent (a small local process bridging this platform to an in-store printer on
  the same LAN) — most real kitchen-printer integrations require the latter, which is a
  meaningfully different piece of software from anything this codebase runs today.
- POS integration is a much larger scope question (which POS? push order data out, or pull
  payment/menu data in?) that depends entirely on a specific vendor's API and hasn't been chosen.

Building a generic "integration framework" now, with no real printer or POS vendor requirement to
build it against, would be speculative complexity — exactly what this phase's instructions warn
against. The event bus already provides the correct extension point; nothing about future printer
or POS work should require changing the order/payment domain itself.
