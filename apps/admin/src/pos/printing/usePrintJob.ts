import type { PrintJob, PrintJobStatus } from "@restaurant/types";
import { apiClient } from "../../lib/api";
import { useActiveLocationId } from "../../context/LocationContext";
import { adapterForConnectionType, type PrintAttemptResult } from "./adapters";

export interface PrintOutcome extends PrintAttemptResult {
  /** Null only in the pre-Phase-57 fallback path (see printOrder below) — no printer has been
   *  configured for this location yet, so there is no PrintJob to show status/retry for. */
  job: PrintJob | null;
}

async function reportStatus(restaurantId: string, jobId: string, status: PrintJobStatus, error?: string): Promise<PrintJob> {
  const { printJob } = await apiClient.request<{ printJob: PrintJob }>(`/restaurants/${restaurantId}/print-jobs/${jobId}`, {
    method: "PATCH",
    body: { status, error },
  });
  return printJob;
}

/**
 * The one place that ties "a print job was created" to "an adapter actually attempted it" — used
 * by every print entry point (CompletedSale, Orders/Kitchen print buttons, printer test print,
 * retry). Always reports back to the server what actually happened (Section 13/17): the caller
 * never has to guess whether a job's status reflects reality.
 *
 * `printWindow`, if given, is a blank tab the caller already opened SYNCHRONOUSLY inside its click
 * handler, before any of this function's awaits — see adapters.ts's ExecuteContext doc comment for
 * why that ordering matters. It's closed here unused if the resolved printer turns out not to be
 * browser_print, so a stray blank tab never lingers.
 */
async function executeAndReport(restaurantId: string, job: PrintJob, mode: "receipt" | "ticket", printWindow?: Window | null): Promise<PrintOutcome> {
  const adapter = adapterForConnectionType(job.printerConnectionType, job.printerConnectionConfig);
  const printing = await reportStatus(restaurantId, job.id, "printing");

  if (printWindow && job.printerConnectionType !== "browser_print") {
    printWindow.close();
  }
  const result = await adapter.execute(job, { mode, printWindow: job.printerConnectionType === "browser_print" ? printWindow : undefined });

  if (!result.success) {
    const failed = await reportStatus(restaurantId, job.id, "failed", result.error);
    return { job: failed, success: false, error: result.error };
  }

  if (job.printerConnectionType === "browser_print") {
    // "success" here only means the print tab opened — it is the one that knows what actually
    // happened once its print dialog closes (PrintOrderPage.tsx / PrintPreviewPage.tsx's own
    // afterprint handler), and reports "printed" itself. Reporting "printed" here too, before that
    // has happened, would claim a print outcome nobody has observed yet.
    return { job: printing, success: true };
  }

  const printed = await reportStatus(restaurantId, job.id, "printed");
  return { job: printed, success: true };
}

export function usePrintJob() {
  const restaurantId = useActiveLocationId();

  async function printOrder(
    kind: "receipt" | "kitchen_ticket",
    orderId: string,
    options: { printerId?: string; isReprint?: boolean } = {},
    printWindow?: Window | null
  ): Promise<PrintOutcome> {
    const mode = kind === "receipt" ? "receipt" : "ticket";
    let printJob: PrintJob;
    try {
      ({ printJob } = await apiClient.request<{ printJob: PrintJob }>(`/restaurants/${restaurantId}/print-jobs`, {
        method: "POST",
        body: { kind, orderId, printerId: options.printerId, isReprint: options.isReprint ?? false },
      }));
    } catch (err) {
      // No printer has been configured for this purpose yet — this is a genuinely-existing,
      // real-world starting state (every restaurant before Phase 57, and every new one until its
      // owner visits Printers), not an edge case to error out of. Preserve the exact pre-Phase-57
      // behavior: open the print page directly, untracked, rather than blocking printing entirely
      // behind a configuration step nothing previously required.
      const status = (err as { status?: number }).status;
      const message = (err as Error).message ?? "";
      if (status === 400 && /no enabled default printer/i.test(message)) {
        if (printWindow) printWindow.location.href = `/print/${mode}/${orderId}`;
        return { job: null, success: Boolean(printWindow), error: printWindow ? undefined : "The browser blocked the print window — allow pop-ups for this site and try again." };
      }
      throw err;
    }
    return executeAndReport(restaurantId, printJob, mode, printWindow);
  }

  async function testPrint(printerId: string, printWindow?: Window | null): Promise<PrintOutcome> {
    const { printJob } = await apiClient.request<{ printJob: PrintJob }>(`/restaurants/${restaurantId}/printers/${printerId}/test-print`, {
      method: "POST",
    });
    return executeAndReport(restaurantId, printJob, "receipt", printWindow);
  }

  async function retry(job: PrintJob, printWindow?: Window | null): Promise<PrintOutcome> {
    const { printJob } = await apiClient.request<{ printJob: PrintJob }>(`/restaurants/${restaurantId}/print-jobs/${job.id}/retry`, {
      method: "POST",
    });
    return executeAndReport(restaurantId, printJob, job.kind === "kitchen_ticket" ? "ticket" : "receipt", printWindow);
  }

  async function history(orderId: string): Promise<PrintJob[]> {
    const { printJobs } = await apiClient.request<{ printJobs: PrintJob[] }>(`/restaurants/${restaurantId}/print-jobs/by-order/${orderId}`);
    return printJobs;
  }

  return { printOrder, testPrint, retry, history };
}
