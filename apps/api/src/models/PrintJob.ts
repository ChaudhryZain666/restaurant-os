import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { PRINTER_CONNECTION_TYPES, PRINT_JOB_KINDS, PRINT_JOB_STATUSES } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 57 — the print-job state machine. `document` is Schema.Types.Mixed (a structured
 * PrintDocument — see packages/types/src/types/printer.ts) generated once at creation time and
 * never regenerated, so a reprint reproduces exactly what was queued rather than a possibly-changed
 * live re-fetch of the order. `printerConnectionType` is likewise a snapshot of the Printer at
 * creation time, so a later printer config edit never retroactively changes what an already-created
 * job thinks its own transport is.
 *
 * A "retry" reuses this same document (PATCH status back to "queued", increment attempts) — it
 * never creates a new order/payment. A "reprint" (a fresh physical copy of an already-printed job)
 * creates a NEW PrintJob row with isReprint:true referencing the same orderId — still never a new
 * order/payment, just a new job row, which is what lets reprint history be listed per order.
 */
const printJobSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    printerId: { type: Schema.Types.ObjectId, ref: "Printer", required: true },
    kind: { type: String, enum: PRINT_JOB_KINDS, required: true },
    status: { type: String, enum: PRINT_JOB_STATUSES, default: "queued" },
    isReprint: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, maxlength: 500 },
    document: { type: Schema.Types.Mixed, required: true },
    printerConnectionType: { type: String, enum: PRINTER_CONNECTION_TYPES, required: true },
    printerConnectionConfig: {
      bridgeUrl: { type: String, maxlength: 200 },
    },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedByRole: { type: String, required: true },
    printedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

printJobSchema.index({ restaurantId: 1, orderId: 1, createdAt: -1 });
printJobSchema.index({ restaurantId: 1, status: 1 });

export type PrintJobDoc = InferSchemaType<typeof printJobSchema> & { _id: Types.ObjectId };
export const PrintJob = model<PrintJobDoc>("PrintJob", printJobSchema);
