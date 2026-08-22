import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

// Meaningful business events only — not a request logger, not every UI click. Kept deliberately
// small and closed (an enum, not a free-text action) so "what can this system record" stays a
// reviewable list rather than growing ad hoc from call sites. AUDIT_ACTIONS/AUDIT_TARGET_TYPES
// live in @restaurant/types now (Phase 12) — this is the only enforcement point, but every
// consumer (this schema, the audit log query validation, the admin UI) reads the same list.
export { AUDIT_ACTIONS, AUDIT_TARGET_TYPES };

const auditLogSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    targetType: { type: String, enum: AUDIT_TARGET_TYPES, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    // Small, action-specific context (e.g. { from: "pending", to: "confirmed" }) — never raw
    // payment amounts beyond what's already visible elsewhere, never card/provider secrets.
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, toJSON: idTransform }
);

auditLogSchema.index({ restaurantId: 1, createdAt: -1 });
auditLogSchema.index({ restaurantId: 1, targetType: 1, targetId: 1, createdAt: -1 });

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };
export const AuditLog = model<AuditLogDoc>("AuditLog", auditLogSchema);
