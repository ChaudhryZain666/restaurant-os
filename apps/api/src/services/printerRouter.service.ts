import type { PrinterPurpose } from "@restaurant/types";
import { Printer } from "../models/Printer.js";
import { ApiError } from "../utils/ApiError.js";

const KIND_TO_PURPOSE: Record<"receipt" | "kitchen_ticket", PrinterPurpose> = {
  receipt: "receipt",
  kitchen_ticket: "kitchen",
};

/**
 * Resolves which Printer a print job should target: an explicit printerId (re-verified to belong
 * to this restaurant — never trusted from the client alone) if given, otherwise the enabled
 * default printer for the purpose this kind maps to. Returns null (not a thrown error) only for the
 * "no default configured" case — the caller turns that into an honest, actionable error rather than
 * a generic 500, since it's an expected, recoverable configuration gap, not a bug.
 */
export async function resolvePrinterForJob(restaurantId: string, kind: "receipt" | "kitchen_ticket", explicitPrinterId?: string) {
  if (explicitPrinterId) {
    const printer = await Printer.findOne({ _id: explicitPrinterId, restaurantId });
    if (!printer) throw ApiError.notFound("Printer not found");
    return printer;
  }
  const purpose = KIND_TO_PURPOSE[kind];
  return Printer.findOne({ restaurantId, purpose, isEnabled: true, isDefault: true });
}
