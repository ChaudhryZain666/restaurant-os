import type { PrintJobStatus } from "@restaurant/types";
import { Badge } from "@restaurant/ui";

const STATUS_COPY: Record<PrintJobStatus, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  queued: { label: "Queued", tone: "neutral" },
  printing: { label: "Printing…", tone: "info" },
  printed: { label: "Printed", tone: "success" },
  failed: { label: "Print failed", tone: "danger" },
  unavailable: { label: "Printer unavailable", tone: "warning" },
};

/** Distinguishes "did my order save" (never affected by this) from "did my printer print it" — see
 *  Section 13's explicit good/bad example. Always paired with text, matching Badge's own doc
 *  comment convention (never color alone). */
export function PrintStatusBadge({ status }: { status: PrintJobStatus }) {
  const { label, tone } = STATUS_COPY[status];
  return <Badge tone={tone}>{label}</Badge>;
}
