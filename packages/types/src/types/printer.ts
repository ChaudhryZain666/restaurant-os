/**
 * Phase 57 — printer/receipt architecture.
 *
 * Key design decision: a Printer's `connectionType` determines where the actual hardware I/O
 * happens, and for every type except `browser_print` that is client-side (the POS browser tab) or
 * a local bridge process on the restaurant's own machine — NEVER the backend. The backend never
 * opens a network connection to a restaurant-supplied host/IP; it only persists configuration and
 * generates print content. This is a deliberate SSRF-avoidance boundary, not an oversight — see
 * docs/pos-printer-architecture.md.
 */

export const PRINTER_PURPOSES = ["receipt", "kitchen", "bar"] as const;
export type PrinterPurpose = (typeof PRINTER_PURPOSES)[number];

/**
 * - browser_print: the OS/browser print dialog against a printer with a normal OS driver (works on
 *   any device/OS/browser; not silent, no raw ESC/POS control like paper cut).
 * - web_serial: direct USB/serial connection via the Web Serial API. Chrome/Edge desktop only —
 *   Safari refuses to implement it, Firefox only behind an experimental flag.
 * - webusb: direct USB connection via the WebUSB API. Chromium-only, same-family limitation.
 * - local_bridge: a small locally-run helper (not shipped this phase — see known limitations) that
 *   listens on localhost and relays raw ESC/POS to a USB/Ethernet/Wi-Fi printer, reachable from any
 *   browser regardless of OS since the browser only ever talks to its own machine's loopback.
 */
export const PRINTER_CONNECTION_TYPES = ["browser_print", "web_serial", "webusb", "local_bridge"] as const;
export type PrinterConnectionType = (typeof PRINTER_CONNECTION_TYPES)[number];

export const PRINTER_PAPER_WIDTHS_MM = [58, 80] as const;
export type PrinterPaperWidthMm = (typeof PRINTER_PAPER_WIDTHS_MM)[number];

export interface PrinterConnectionConfig {
  /** local_bridge only. Must be a loopback URL (http://localhost:<port> or http://127.0.0.1:<port>)
   *  — validated server-side; a restaurant can never point this at an arbitrary network host. */
  bridgeUrl?: string;
}

export interface Printer {
  id: string;
  restaurantId: string;
  name: string;
  purpose: PrinterPurpose;
  connectionType: PrinterConnectionType;
  paperWidthMm: PrinterPaperWidthMm;
  isEnabled: boolean;
  /** At most one enabled default printer per (restaurantId, purpose). */
  isDefault: boolean;
  connectionConfig?: PrinterConnectionConfig;
  createdAt: string;
  updatedAt: string;
}

export const PRINT_JOB_KINDS = ["receipt", "kitchen_ticket", "test"] as const;
export type PrintJobKind = (typeof PRINT_JOB_KINDS)[number];

/**
 * queued -> printing -> printed | failed | unavailable. "failed"/"unavailable" can be retried
 * (queued again on the same job — a retry never creates a new order/payment/job-for-a-new-order).
 * "unavailable" is distinct from "failed": it means the chosen printer/transport could not even be
 * attempted (e.g. Web Serial unsupported in this browser, or no default printer configured for this
 * purpose) rather than a real print attempt that failed partway.
 */
export const PRINT_JOB_STATUSES = ["queued", "printing", "printed", "failed", "unavailable"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/**
 * Rendering-agnostic structured content: the browser_print tier turns this into HTML for an
 * existing print-friendly page, hardware adapters turn it into ESC/POS bytes (see escpos.ts).
 * Deliberately generated once, server-side, at job-creation time and stored on the job — so a
 * reprint reproduces what was actually queued to print, not a possibly-different live re-fetch.
 */
export type PrintLine =
  | { type: "text"; text: string; bold?: boolean; align?: "left" | "center" | "right" }
  | { type: "row"; left: string; right: string; bold?: boolean }
  | { type: "rule" }
  | { type: "spacer" };

export interface PrintDocument {
  title: string;
  lines: PrintLine[];
  /** Pre-built raw ESC/POS byte sequence (base64-encoded), for web_serial/webusb/local_bridge
   *  adapters to write directly to the device — generated server-side from `lines` using the
   *  target printer's paperWidthMm (see escpos.ts). Always present alongside `lines` so any
   *  printer's job carries both a human-previewable form and a ready-to-send byte form. */
  escposBase64: string;
}

export interface PrintJob {
  id: string;
  restaurantId: string;
  orderId?: string;
  printerId: string;
  kind: PrintJobKind;
  status: PrintJobStatus;
  isReprint: boolean;
  attempts: number;
  lastError?: string;
  document: PrintDocument;
  /** Both snapshotted from the Printer at job-creation time so a later printer config edit (e.g. a
   *  changed bridge URL) never retroactively changes what an adapter thinks it should do with an
   *  already-created job. */
  printerConnectionType: PrinterConnectionType;
  printerConnectionConfig?: PrinterConnectionConfig;
  requestedByUserId: string;
  requestedByRole: string;
  printedAt?: string;
  createdAt: string;
  updatedAt: string;
}
