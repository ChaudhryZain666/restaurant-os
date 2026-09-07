import { z } from "zod";
import { PRINTER_CONNECTION_TYPES, PRINTER_PURPOSES, PRINT_JOB_KINDS } from "@restaurant/types";

const paperWidthSchema = z.union([z.literal(58), z.literal(80)]);

/** local_bridge is the only connection type that stores a URL, and it must be loopback-only — a
 *  restaurant can never point this at an arbitrary network host (see printer.ts's doc comment). */
const bridgeUrlSchema = z
  .string()
  .max(200)
  .regex(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/[\w-]*)?$/i, "Must be a local address, e.g. http://localhost:9100");

const connectionConfigSchema = z
  .object({
    bridgeUrl: bridgeUrlSchema.optional(),
  })
  .optional();

export const createPrinterSchema = z.object({
  name: z.string().min(1).max(50),
  purpose: z.enum(PRINTER_PURPOSES),
  connectionType: z.enum(PRINTER_CONNECTION_TYPES),
  paperWidthMm: paperWidthSchema.default(80),
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  connectionConfig: connectionConfigSchema,
});
export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;

export const updatePrinterSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  purpose: z.enum(PRINTER_PURPOSES).optional(),
  connectionType: z.enum(PRINTER_CONNECTION_TYPES).optional(),
  paperWidthMm: paperWidthSchema.optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  connectionConfig: connectionConfigSchema,
});
export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;

/** "test" is deliberately excluded here — a test print never touches a real Order (Section 14) and
 *  goes through its own dedicated POST /printers/:printerId/test-print endpoint instead, which
 *  needs no order and always targets one specific printer. */
export const createPrintJobSchema = z.object({
  kind: z.enum(PRINT_JOB_KINDS.filter((k) => k !== "test") as ["receipt", "kitchen_ticket"]),
  orderId: z.string().min(1),
  /** Explicit printer choice — if omitted, the server routes to the enabled default printer for
   *  this kind's purpose (receipt -> "receipt", kitchen_ticket -> "kitchen"). */
  printerId: z.string().optional(),
  isReprint: z.boolean().default(false),
});
export type CreatePrintJobInput = z.infer<typeof createPrintJobSchema>;

/** The client reports back what actually happened when it attempted the print via whichever
 *  adapter — never "queued" (that's the only status the server itself sets, at creation). */
export const updatePrintJobStatusSchema = z
  .object({
    status: z.enum(["printing", "printed", "failed", "unavailable"]),
    error: z.string().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.status === "failed" || val.status === "unavailable") && !val.error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "error is required when reporting a failed/unavailable print" });
    }
  });
export type UpdatePrintJobStatusInput = z.infer<typeof updatePrintJobStatusSchema>;
