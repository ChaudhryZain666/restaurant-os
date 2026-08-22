import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

// Enum values inlined (not imported from @restaurant/types) — see Restaurant.ts's comment on
// why: importing an enum array from another package has previously made Mongoose's
// InferSchemaType collapse the whole schema to `unknown`.
const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TICKET_CATEGORIES = ["menu", "orders", "billing", "account", "technical", "data_recovery", "other"] as const;
const TICKET_SOURCES = ["help_widget", "support_center", "admin", "system"] as const;

const ticketContextSchema = new Schema(
  {
    app: { type: String, enum: ["web", "admin"] },
    route: { type: String, maxlength: 200 },
    userAgent: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const ticketStatusHistoryEntrySchema = new Schema(
  {
    status: { type: String, enum: TICKET_STATUSES, required: true },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const supportTicketSchema = new Schema(
  {
    ticketNumber: { type: String, required: true, unique: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    // Snapshot of the customer's opening message — avoids a join just to render a ticket list
    // preview. The full, authoritative conversation lives in SupportMessage.
    description: { type: String, required: true, maxlength: 5000 },
    status: { type: String, enum: TICKET_STATUSES, default: "open", index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: "normal", index: true },
    category: { type: String, enum: TICKET_CATEGORIES, default: "other", index: true },
    source: { type: String, enum: TICKET_SOURCES, default: "help_widget" },
    // No standalone indexes on createdBy/restaurantId/assignedTo: each is the leading field of
    // one of the three compound indexes below, so a separate single-field index on any of them
    // would be a pure duplicate (compound index prefixes already serve those queries).
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Optional: a ticket may have no restaurant context at all (a general account question).
    // For restaurant-scoped staff, always server-derived from req.user.restaurantId — never
    // trusted from a request body (see support.controller.ts).
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant" },
    /**
     * Reserved for a future Agency model. No Agency collection exists anywhere in this
     * codebase (confirmed by repo-wide search before adding this field) — this is deliberately
     * NOT given a `ref` and is never set by any current code path. It exists only so that once
     * an Agency model is introduced, tickets don't need a schema migration to carry that
     * relationship. See docs/support-architecture.md for the integration boundary.
     */
    agencyId: { type: Schema.Types.ObjectId },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    context: { type: ticketContextSchema },
    statusHistory: { type: [ticketStatusHistoryEntrySchema], default: [] },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

supportTicketSchema.index({ restaurantId: 1, status: 1 });
supportTicketSchema.index({ createdBy: 1, status: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });

const supportMessageSchema = new Schema(
  {
    // No standalone index: the compound index below already covers ticketId-only queries via
    // its leading-field prefix.
    ticketId: { type: Schema.Types.ObjectId, ref: "SupportTicket", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorType: { type: String, enum: ["customer", "support"], required: true },
    content: { type: String, required: true, maxlength: 5000 },
    // The single enforcement point for "internal notes are never customer-visible": every query
    // that returns messages to a customer-facing context filters { isInternal: { $ne: true } }
    // at the database level (see support.controller.ts) — never relies on hiding it in the UI.
    // Attachments are a deliberate extension point, not built in this phase: no file-upload
    // infrastructure is wired up yet (see docs/support-architecture.md), so there is no
    // attachments field here to avoid a schema that implies a capability that doesn't exist.
    isInternal: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: idTransform }
);

supportMessageSchema.index({ ticketId: 1, createdAt: 1 });

export type SupportTicketDoc = InferSchemaType<typeof supportTicketSchema>;
export const SupportTicket = model<SupportTicketDoc>("SupportTicket", supportTicketSchema);

export type SupportMessageDoc = InferSchemaType<typeof supportMessageSchema>;
export const SupportMessage = model<SupportMessageDoc>("SupportMessage", supportMessageSchema);
