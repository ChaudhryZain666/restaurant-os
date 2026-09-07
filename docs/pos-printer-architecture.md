# POS printer & receipt architecture (Phase 57)

## What existed before this phase

The POS already had a working, browser-print-based receipt/kitchen-ticket system (Phase 14):
`apps/admin/src/pages/PrintOrderPage.tsx` (staff, dual-mode `/print/:mode/:id`) and
`apps/web/src/pages/PrintReceiptPage.tsx` (customer, `/orders/:id/receipt`), both fetching
`GET /orders/:id` and auto-triggering `window.print()`. Menu item imagery already worked in the POS
register grid (`apps/admin/src/pos/components/MenuBrowser.tsx`'s `ItemCard`, with lazy loading and a
monogram-tile fallback on missing/broken images). Neither of those was rebuilt this phase — they are
preserved exactly as they were.

What genuinely did not exist: any printer abstraction, any print-job state tracking, any reprint
audit trail, or any hardware/ESC-POS integration path. `docs/operations-architecture-boundaries.md`
and the original `docs/pos-architecture.md` both explicitly named this as deferred, future work —
this phase builds it.

## The core design decision: where does hardware I/O happen?

**Never on the backend.** A restaurant's receipt/kitchen printer lives on the restaurant's own LAN
(or is plugged into the same PC as the POS browser tab) — a cloud-hosted API server has no route to
it that doesn't involve the server accepting an arbitrary, restaurant-supplied host/IP and opening an
outbound connection to it. That is a textbook SSRF surface (Section 19 of the brief calls this out
explicitly), and it also just doesn't work in practice: most restaurant LANs are behind NAT with no
public IP for a cloud server to reach.

So the backend's job is narrow and safe: **persist Printer configuration, persist PrintJob records
and their state, and generate print content** (both a human-readable structured form and pre-built
ESC/POS bytes). The backend never makes a network call to a printer. All actual hardware I/O happens
either in the browser tab running the POS (WebUSB/Web Serial, or the existing browser print dialog)
or in a local bridge process running on the restaurant's own machine, which the browser talks to over
`localhost` only.

## Research findings that shaped this (see also Section 9 of the brief)

- **Web Serial**: Chrome/Edge desktop only. Safari has publicly declined to implement it (fingerprinting
  concerns); Firefox only has it experimentally behind a flag in Nightly. No iPad/Safari support at all
  — a real, material limitation for restaurants using iPads.
- **WebUSB**: Chromium-only, with known compatibility quirks even there.
- **Local print-bridge/agent pattern**: the dominant pattern real commercial POS/ERP systems actually
  use (e.g. Odoo's POS print agent, various "ESC/POS bridge" browser extensions and local apps) — a
  small helper process installed once on the restaurant's own PC, listening on `localhost`, relaying
  raw ESC/POS bytes to USB/Ethernet/Wi-Fi printers. Works from any browser on any OS, since the
  browser only ever talks to its own machine's loopback address, never a bare LAN IP.
- **Browser/OS print (`window.print()`)**: works everywhere, on any OS/browser/device, against
  any printer with a normal OS driver — but shows a print dialog (not silent) and gives no raw ESC/POS
  control (no explicit paper-cut command, no codepage control).

## The chosen architecture

```
Order (or a test-print request)
  -> PrintJob (persisted; queued -> printing -> printed | failed | unavailable)
    -> resolved via a Printer (location-scoped config: purpose, connectionType, paper width)
      -> a client-side adapter, keyed by the Printer's connectionType:
           browser_print  — opens the existing /print/:mode/:id (real orders) or a generic
                             preview page (test prints), calls window.print()
           web_serial     — navigator.serial, writes the job's pre-built ESC/POS bytes
           webusb         — navigator.usb, writes the job's pre-built ESC/POS bytes
           local_bridge   — fetch(printer.connectionConfig.bridgeUrl + "/print", ...) — bridgeUrl
                             is validated server-side to be loopback-only (localhost/127.0.0.1)
```

`Printer` (`apps/api/src/models/Printer.ts`) is a standalone, location-scoped model (mirroring
`Table.ts`'s established pattern) rather than a field on `Restaurant.settings`, because a restaurant
can have several — front counter, one or more kitchen stations, a bar — each independently
identified and configured. `purpose` (`receipt` | `kitchen` | `bar`) plus `isDefault` gives simple,
real routing (a receipt print job goes to the enabled default `receipt` printer, a kitchen ticket to
the enabled default `kitchen` printer) without building a full per-menu-category routing UI —
extending `purpose` to include finer-grained station names, or adding a per-category routing rule, is
a natural future extension of this same model and does not require a redesign.

`PrintJob` (`apps/api/src/models/PrintJob.ts`) snapshots both its rendered `document` (structured
lines + pre-built ESC/POS bytes) and the target printer's `connectionType` at creation time — so a
later printer-config edit, or a later change to the underlying order, never retroactively changes
what a historical job's reprint would show or how an adapter should have handled it.

Content generation (`apps/api/src/services/printContent.service.ts`) reuses the exact field
selection `PrintOrderPage.tsx` already established (restaurant name/address/phone/logo via the same
live join `order.controller.ts`'s `getOrder` already performs — `Order` itself never snapshots these
— plus customer name/phone for kitchen tickets only, and never prices/payment info on a kitchen
ticket). The ESC/POS byte encoding itself (`apps/api/src/services/escpos.ts`) is a small, dependency-
free, hand-rolled builder — the full ESC/POS command set is far larger than a receipt/ticket needs,
so no third-party `escpos` package was added.

## Printer/receipt separation from order/payment (Section 17)

Printing is created strictly **after** order/payment success, as its own independent resource
(`POST /restaurants/:id/print-jobs`), never inside the order-creation transaction. A print job
failing never touches the order or payment; retrying a print job (`POST .../print-jobs/:id/retry`)
reuses the same job row and never creates a new order, payment, customer, or job.

## What is genuinely verified vs. not (see the Phase 57 final report's Section G for the full,
explicit compatibility matrix — this file states the architecture, that section states verification
status).
