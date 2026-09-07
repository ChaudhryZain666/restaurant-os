import type { Request, Response } from "express";
import type { CreatePrinterInput, UpdatePrinterInput } from "@restaurant/validation";
import type { PrinterPaperWidthMm } from "@restaurant/types";
import { Printer } from "../models/Printer.js";
import { PrintJob } from "../models/PrintJob.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { buildTestDocument } from "../services/printContent.service.js";

export async function listPrinters(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const printers = await Printer.find({ restaurantId }).sort({ purpose: 1, name: 1 });
  sendSuccess(res, { printers: printers.map((p) => p.toJSON()) });
}

export async function createPrinter(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const input = req.body as CreatePrinterInput;

  // At most one enabled default per (restaurant, purpose) — see Printer.ts's doc comment on why
  // this is enforced here rather than a partial unique index.
  if (input.isDefault) {
    await Printer.updateMany({ restaurantId, purpose: input.purpose, isDefault: true }, { $set: { isDefault: false } });
  }

  const printer = await Printer.create({ ...input, restaurantId });
  await recordAuditEvent({
    restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "printer.created",
    targetType: "printer",
    targetId: printer.id,
    metadata: { name: printer.name, purpose: printer.purpose, connectionType: printer.connectionType },
  });
  sendSuccess(res, { printer: printer.toJSON() }, 201);
}

export async function updatePrinter(req: Request, res: Response) {
  const { restaurantId, printerId } = req.params;
  const updates = req.body as UpdatePrinterInput;

  const existing = await Printer.findOne({ _id: printerId, restaurantId });
  if (!existing) throw ApiError.notFound("Printer not found");

  if (updates.isDefault) {
    const purpose = updates.purpose ?? existing.purpose;
    await Printer.updateMany({ restaurantId, purpose, isDefault: true, _id: { $ne: printerId } }, { $set: { isDefault: false } });
  }

  Object.assign(existing, updates);
  await existing.save();

  await recordAuditEvent({
    restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "printer.updated",
    targetType: "printer",
    targetId: existing.id,
    metadata: { name: existing.name },
  });
  sendSuccess(res, { printer: existing.toJSON() });
}

/**
 * Deletion is allowed unconditionally (unlike Table.deleteTable's active-order guard) — a PrintJob
 * snapshots its own document/printerConnectionType at creation time (see PrintJob.ts), so deleting
 * the Printer a historical job pointed at never corrupts that job's own record or reprint history.
 */
export async function deletePrinter(req: Request, res: Response) {
  const { restaurantId, printerId } = req.params;
  const result = await Printer.deleteOne({ _id: printerId, restaurantId });
  if (result.deletedCount === 0) throw ApiError.notFound("Printer not found");

  await recordAuditEvent({
    restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "printer.deleted",
    targetType: "printer",
    targetId: printerId,
  });
  res.status(204).send();
}

/** Section 14 — lets staff confirm a printer is actually connected without placing a fake order.
 *  Creates a real, trackable PrintJob (kind: "test") with canned content — same state machine as a
 *  real receipt/ticket job, so failure/retry works identically. */
export async function testPrintPrinter(req: Request, res: Response) {
  const { restaurantId, printerId } = req.params;
  const printer = await Printer.findOne({ _id: printerId, restaurantId });
  if (!printer) throw ApiError.notFound("Printer not found");

  const document = buildTestDocument(printer.name, printer.paperWidthMm as PrinterPaperWidthMm);
  const job = await PrintJob.create({
    restaurantId,
    printerId: printer.id,
    kind: "test",
    document,
    printerConnectionType: printer.connectionType,
    printerConnectionConfig: printer.connectionConfig,
    requestedByUserId: req.user!.id,
    requestedByRole: req.user!.role,
  });
  sendSuccess(res, { printJob: job.toJSON() }, 201);
}
