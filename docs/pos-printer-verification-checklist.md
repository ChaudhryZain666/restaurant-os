# POS printer verification checklist (Phase 57)

This environment has no physical printer attached, so nothing below claims hardware verification
that didn't happen. Use this checklist before relying on printing for a real restaurant's opening
shift. See `docs/pos-printer-architecture.md` for the underlying design.

## Before going live at a location

1. **Add each printer** in Owner Portal → Printers, choosing the connection type that matches the
   hardware actually present (see the compatibility matrix in the Phase 57 report's Section G).
2. **Run "Test print" on every printer** and confirm a physical test receipt/ticket actually comes
   out, clearly labeled "TEST PRINT" — this is the one step this checklist cannot do for you.
3. **Set a default printer for each purpose you use** (receipt, kitchen, bar) — a purpose with no
   enabled default will show staff an honest "no printer configured" message instead of silently
   failing.
4. **Verify paper width** — an 80mm printer configured as 58mm (or vice versa) will still print, but
   lines will wrap incorrectly. Confirm actual receipt output is legible, not just that it printed.

## Per connection type

- **Browser / OS print**: confirm the printer has a working driver installed on the till/register
  computer and is set as reachable from the browser being used for the POS (test via any other
  application's print dialog first if unsure).
- **Web Serial / WebUSB**: confirm the till is running Chrome or Edge on desktop — these do not work
  in Safari, Firefox, or on iPad, by design of the browsers themselves (see the architecture doc).
  The first test print on a fresh browser profile will prompt for device permission — grant it.
- **Local bridge (network printer)**: not usable yet — the local bridge helper program itself is not
  shipped in this phase (see the Phase 57 report's Known Limitations). Do not configure this
  connection type for a printer you need working today.

## What to do if a test print fails

Read the on-screen error — it distinguishes "printer unavailable" (nothing configured/reachable)
from "print failed" (an attempt was made and didn't succeed) on purpose. Retry after fixing the
underlying cause (power, cable, paper, browser permission). A failed test print never affects any
real order — it's a real PrintJob row, but it never touches Order/Payment data.

## Ongoing

- If receipts/tickets start failing during service, staff will see it on the order/kitchen-ticket
  print buttons and on the POS completed-sale screen (a red "Print failed" badge with a Retry
  button) — this is not silent.
- Reprints are always available from Orders/Kitchen and are clearly marked "REPRINT" on the printed
  page itself.
