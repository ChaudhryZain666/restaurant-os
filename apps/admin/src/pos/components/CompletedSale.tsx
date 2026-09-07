import { useEffect, useState } from "react";
import type { Order, PrintJob } from "@restaurant/types";
import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { IconCheck } from "../../components/icons";
import { usePrintJob } from "../printing/usePrintJob";
import { PrintStatusBadge } from "../printing/PrintStatusBadge";

/**
 * Phase 57 — printing is now tracked (queued/printing/printed/failed) instead of a bare
 * window.open with no feedback, but the core principle from Section 3/17 is unchanged and load-
 * bearing here specifically: the sale above this component has ALREADY succeeded by the time this
 * renders (RegisterPage only shows CompletedSale after a real 201 from POST .../pos/orders) — a
 * kitchen-ticket or receipt print failing here can never undo that, and staff can always retry.
 */
export function CompletedSale({ order, onNewSale }: { order: Order; onNewSale: () => void }) {
  const { printOrder, retry } = usePrintJob();
  const [receiptJob, setReceiptJob] = useState<PrintJob | null>(null);
  const [ticketJob, setTicketJob] = useState<PrintJob | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  // Automatic kitchen-ticket print on order completion (Section 16) — best-effort: if no default
  // kitchen printer is configured, this fails silently into the "unavailable"-shaped 400 rather than
  // interrupting the completed-sale screen staff need to move on from immediately.
  //
  // Honest limitation for a browser_print kitchen printer specifically: opening a print tab with no
  // preceding user click is exactly what real browsers' popup blockers exist to stop — there is no
  // click here to hang a pre-opened window off of (unlike handlePrintReceipt below), so this
  // predictably reports "failed" with a clear "blocked" message for that one connection type, and
  // staff see an immediate Retry button (itself a real click) rather than a silent automatic print.
  // Other connection types (mock/webusb/serial/bridge) need no window handle and print automatically
  // without this restriction.
  useEffect(() => {
    let cancelled = false;
    printOrder("kitchen_ticket", order.id)
      .then((outcome) => {
        if (!cancelled) setTicketJob(outcome.job);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  async function handlePrintReceipt(isReprint: boolean) {
    // Opened synchronously, before any await, so a real browser's popup blocker (which tracks
    // whether window.open happens within the original click's user-gesture context) never treats
    // this as an unsolicited popup — see adapters.ts's ExecuteContext doc comment.
    const printWindow = window.open("", "_blank");
    setReceiptBusy(true);
    try {
      const outcome = await printOrder("receipt", order.id, { isReprint }, printWindow);
      setReceiptJob(outcome.job);
    } finally {
      setReceiptBusy(false);
    }
  }

  async function handleRetryTicket() {
    if (!ticketJob) return;
    const printWindow = window.open("", "_blank");
    const outcome = await retry(ticketJob, printWindow);
    setTicketJob(outcome.job);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
        <IconCheck className="h-8 w-8" />
      </span>
      <div>
        <h1 className="font-heading text-3xl font-semibold text-foreground">Order #{order.orderNumber}</h1>
        <p className="mt-1 text-muted">
          {formatCurrency(order.total, order.currency)} · {order.paymentMethod === "cash" ? "Cash" : "Card"}
        </p>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Kitchen ticket:</span>
          {ticketJob ? <PrintStatusBadge status={ticketJob.status} /> : <span className="text-muted">—</span>}
          {ticketJob && (ticketJob.status === "failed" || ticketJob.status === "unavailable") && (
            <button onClick={handleRetryTicket} className="text-xs font-medium text-primary hover:underline">
              Retry
            </button>
          )}
        </div>
        {receiptJob && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Receipt:</span>
            <PrintStatusBadge status={receiptJob.status} />
            {(receiptJob.status === "failed" || receiptJob.status === "unavailable") && (
              <button onClick={() => handlePrintReceipt(false)} className="text-xs font-medium text-primary hover:underline">
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" disabled={receiptBusy} onClick={() => handlePrintReceipt(Boolean(receiptJob))}>
          {receiptJob ? "Reprint receipt" : "Print receipt"}
        </Button>
        <Button size="lg" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </div>
  );
}
