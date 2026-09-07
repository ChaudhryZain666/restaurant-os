import type { PrintJob, PrinterConnectionType } from "@restaurant/types";

export interface PrintAttemptResult {
  success: boolean;
  /** Absent on success. Always a plain, staff-readable sentence — never a raw exception string. */
  error?: string;
}

export interface ExecuteContext {
  mode: "receipt" | "ticket";
  /**
   * A blank tab the CALLER already opened synchronously inside the original click handler, before
   * any `await` — real browsers can (and do) silently block `window.open` once a synchronous
   * user-gesture context has been lost across an async boundary (this codebase's own print flow
   * necessarily awaits a job-creation request first), so every print entry point opens this blank
   * tab up front and hands it here to be navigated rather than opening a fresh window this late.
   * Only meaningful to browserPrintAdapter; other adapters need no visible tab and close it.
   */
  printWindow?: Window | null;
}

export interface PrinterAdapter {
  /** Attempts the actual hardware/OS I/O for one already-created PrintJob. Never creates,
   *  mutates, or deletes an Order/Payment — see docs/pos-printer-architecture.md. */
  execute(job: PrintJob, context: ExecuteContext): Promise<PrintAttemptResult>;
}

/**
 * Works on any OS/browser/device against any printer with a normal OS driver installed — the one
 * universally-available tier (Section 9's research: Web Serial/WebUSB are Chromium-only, local
 * bridge needs a helper app that isn't shipped this phase). Navigates the caller's pre-opened blank
 * tab to the EXISTING /print/:mode/:id page (unchanged rendering — see PrintOrderPage.tsx); that
 * page itself calls window.print() and reports the job's outcome back via PATCH once the print
 * dialog closes. The caller here can only know "the print tab loaded," not "ink hit paper" —
 * window.print() gives no such confirmation in any browser — so this resolves optimistically and
 * the job's real status is updated asynchronously by the opened tab.
 */
export const browserPrintAdapter: PrinterAdapter = {
  async execute(job, { mode, printWindow }) {
    // A real receipt/kitchen-ticket job reuses the existing /print/:mode/:id page unchanged; a
    // test print (no orderId) has no order to render there, so it opens a small generic preview
    // page instead that renders the job's own structured document directly.
    const url = job.orderId ? `/print/${mode}/${job.orderId}?jobId=${job.id}` : `/print/preview/${job.id}`;
    if (!printWindow) {
      return { success: false, error: "The browser blocked the print window — allow pop-ups for this site and try again." };
    }
    printWindow.location.href = url;
    return { success: true };
  },
};

function unsupported(reason: string): PrinterAdapter {
  return {
    async execute() {
      return { success: false, error: reason };
    },
  };
}

/** Real code, genuinely feature-detected — but never exercised against physical hardware in this
 *  environment (no Chrome + real serial thermal printer available here). See the Phase 57 report's
 *  compatibility matrix for exactly what is and isn't verified. */
export const webSerialAdapter: PrinterAdapter = {
  async execute(job) {
    const nav = navigator as Navigator & { serial?: { requestPort(): Promise<unknown> } };
    if (!nav.serial) return { success: false, error: "This browser doesn't support Web Serial — use Chrome or Edge on desktop, or a different printer connection." };
    try {
      const port = (await nav.serial.requestPort()) as {
        open(options: { baudRate: number }): Promise<void>;
        writable: WritableStream<Uint8Array>;
        close(): Promise<void>;
      };
      await port.open({ baudRate: 9600 });
      const bytes = Uint8Array.from(atob(job.document.escposBase64), (c) => c.charCodeAt(0));
      const writer = port.writable.getWriter();
      await writer.write(bytes);
      writer.releaseLock();
      await port.close();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message || "Could not reach the printer over Web Serial." };
    }
  },
};

export const webUsbAdapter: PrinterAdapter = {
  async execute(job) {
    const nav = navigator as Navigator & { usb?: { requestDevice(options: { filters: unknown[] }): Promise<unknown> } };
    if (!nav.usb) return { success: false, error: "This browser doesn't support WebUSB — use Chrome or Edge, or a different printer connection." };
    try {
      const device = (await nav.usb.requestDevice({ filters: [] })) as {
        open(): Promise<void>;
        selectConfiguration(n: number): Promise<void>;
        claimInterface(n: number): Promise<void>;
        transferOut(endpoint: number, data: Uint8Array): Promise<unknown>;
        close(): Promise<void>;
      };
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      const bytes = Uint8Array.from(atob(job.document.escposBase64), (c) => c.charCodeAt(0));
      await device.transferOut(1, bytes);
      await device.close();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message || "Could not reach the printer over WebUSB." };
    }
  },
};

/** Talks to a small locally-run helper process over the restaurant's own loopback address (never a
 *  bare LAN IP — validated server-side, see packages/validation/src/printer.ts). The helper app
 *  itself is NOT shipped this phase (a native/background executable is a separate deliverable) — so
 *  this adapter's real network call will genuinely fail with "connection refused" in this
 *  environment, which is honestly exactly what it should do until that helper exists. */
export function localBridgeAdapter(bridgeUrl: string | undefined): PrinterAdapter {
  return {
    async execute(job) {
      if (!bridgeUrl) return { success: false, error: "This printer has no local bridge address configured." };
      try {
        const res = await fetch(`${bridgeUrl}/print`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ escposBase64: job.document.escposBase64 }),
        });
        if (!res.ok) return { success: false, error: `The print bridge responded with an error (HTTP ${res.status}).` };
        return { success: true };
      } catch {
        return { success: false, error: "Could not reach the local print bridge — is it running on this computer?" };
      }
    },
  };
}

/** Deterministic, hardware-free — used by automated tests to exercise success/failure/retry states
 *  without a browser print dialog or real device. Never used for a real printer's connectionType. */
export function mockAdapter(mode: "success" | "fail" = "success"): PrinterAdapter {
  return {
    async execute() {
      return mode === "success" ? { success: true } : { success: false, error: "Simulated printer failure (mock adapter)." };
    },
  };
}

export function adapterForConnectionType(connectionType: PrinterConnectionType, connectionConfig?: { bridgeUrl?: string }): PrinterAdapter {
  switch (connectionType) {
    case "browser_print":
      return browserPrintAdapter;
    case "web_serial":
      return webSerialAdapter;
    case "webusb":
      return webUsbAdapter;
    case "local_bridge":
      return localBridgeAdapter(connectionConfig?.bridgeUrl);
    default:
      return unsupported(`Unknown printer connection type: ${connectionType}`);
  }
}
