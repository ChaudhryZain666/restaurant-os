import type { Request, Response } from "express";
import type { Order as OrderType, PrinterPaperWidthMm } from "@restaurant/types";
import type { CreatePrintJobInput, UpdatePrintJobStatusInput } from "@restaurant/validation";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { PrintJob } from "../models/PrintJob.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { resolvePrinterForJob } from "../services/printerRouter.service.js";
import { buildKitchenTicketDocument, buildReceiptDocument } from "../services/printContent.service.js";

/**
 * Mirrors order.controller.ts's getOrder projection exactly (Order never snapshots the
 * restaurant's own name/phone/address/logo — see models/Order.ts — so every consumer that prints a
 * receipt/ticket re-joins it live the same way) plus a customer name/phone join, only performed
 * when a kitchen ticket actually needs it.
 */
async function loadOrderForPrint(restaurantId: string, orderId: string, needsCustomerInfo: boolean): Promise<OrderType> {
  const order = await Order.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");

  const [restaurant, customer] = await Promise.all([
    Restaurant.findById(order.restaurantId).select("name phone address city state postalCode logo"),
    needsCustomerInfo ? User.findById(order.customerId).select("name phone") : Promise.resolve(null),
  ]);

  return {
    ...order.toJSON(),
    restaurantName: restaurant?.name,
    restaurantPhone: restaurant?.phone,
    restaurantAddress: restaurant ? [restaurant.address, restaurant.city, restaurant.state, restaurant.postalCode].filter(Boolean).join(", ") : undefined,
    restaurantLogo: restaurant?.logo,
    customerName: customer?.name,
    customerPhone: customer?.phone,
  } as unknown as OrderType;
}

/**
 * Creates a print job for a real order's receipt or kitchen ticket. Content is generated once,
 * here, and stored on the job (see PrintJob.ts) — the actual hardware I/O never happens on this
 * server; the frontend adapter for the resolved printer's connectionType performs it and reports
 * back via updatePrintJobStatus. See docs/pos-printer-architecture.md.
 */
export async function createPrintJob(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const input = req.body as CreatePrintJobInput;

  // Resource existence/tenant-scoping is checked before anything else — a request for an order
  // that doesn't belong to this restaurant should 404 regardless of what printers happen to be
  // configured here, not be masked by an unrelated "no printer configured" 400.
  const order = await loadOrderForPrint(restaurantId, input.orderId, input.kind === "kitchen_ticket");

  const printer = await resolvePrinterForJob(restaurantId, input.kind, input.printerId);
  if (!printer) {
    throw ApiError.badRequest(
      `No enabled default printer is configured for ${input.kind === "kitchen_ticket" ? "kitchen tickets" : "receipts"} at this location — configure one in Settings first`
    );
  }
  const paperWidthMm = printer.paperWidthMm as PrinterPaperWidthMm;
  const document = input.kind === "receipt" ? buildReceiptDocument(order, paperWidthMm) : buildKitchenTicketDocument(order, paperWidthMm);

  const job = await PrintJob.create({
    restaurantId,
    orderId: input.orderId,
    printerId: printer.id,
    kind: input.kind,
    isReprint: input.isReprint,
    document,
    printerConnectionType: printer.connectionType,
    printerConnectionConfig: printer.connectionConfig,
    requestedByUserId: req.user!.id,
    requestedByRole: req.user!.role,
  });

  sendSuccess(res, { printJob: job.toJSON() }, 201);
}

/**
 * The frontend adapter reports back what actually happened after attempting the print — this is
 * the one place "did my order save" (already true, unaffected) and "did my printer print it" (this
 * field, entirely separate) are distinguished. See Section 13/17.
 */
export async function updatePrintJobStatus(req: Request, res: Response) {
  const { restaurantId, jobId } = req.params;
  const { status, error } = req.body as UpdatePrintJobStatusInput;

  const job = await PrintJob.findOne({ _id: jobId, restaurantId });
  if (!job) throw ApiError.notFound("Print job not found");

  job.status = status;
  job.lastError = status === "failed" || status === "unavailable" ? error : undefined;
  if (status === "printed") job.printedAt = new Date();
  if (status === "printing") job.attempts += 1;
  await job.save();

  if (status === "failed" || status === "unavailable") {
    await recordAuditEvent({
      restaurantId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "print_job.failed",
      targetType: "print_job",
      targetId: job.id,
      metadata: { kind: job.kind, error, orderId: job.orderId?.toString() },
    });
  }

  sendSuccess(res, { printJob: job.toJSON() });
}

/** A retry reuses the SAME job/document — never creates a new order, payment, or job (Section 7). */
export async function retryPrintJob(req: Request, res: Response) {
  const { restaurantId, jobId } = req.params;
  const job = await PrintJob.findOne({ _id: jobId, restaurantId });
  if (!job) throw ApiError.notFound("Print job not found");
  if (job.status !== "failed" && job.status !== "unavailable") {
    throw ApiError.badRequest("Only a failed or unavailable print job can be retried");
  }

  job.status = "queued";
  job.lastError = undefined;
  await job.save();
  sendSuccess(res, { printJob: job.toJSON() });
}

/** Fetches a single job directly — used by the generic print-preview page for jobs with no
 *  underlying order (test prints), which can't be looked up "by order". */
export async function getPrintJob(req: Request, res: Response) {
  const { restaurantId, jobId } = req.params;
  const job = await PrintJob.findOne({ _id: jobId, restaurantId });
  if (!job) throw ApiError.notFound("Print job not found");
  sendSuccess(res, { printJob: job.toJSON() });
}

/** Reprint history for an order — used by the UI to show "printed 2x, last at ..." and to power a
 *  visible "REPRINT" indication on any job after the first. */
export async function listPrintJobsForOrder(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  const jobs = await PrintJob.find({ restaurantId, orderId }).sort({ createdAt: -1 });
  sendSuccess(res, { printJobs: jobs.map((j) => j.toJSON()) });
}
