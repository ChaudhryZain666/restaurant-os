import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { AGENCY_AUDIT_ACTIONS, AGENCY_AUDIT_TARGET_TYPES } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

export { AGENCY_AUDIT_ACTIONS, AGENCY_AUDIT_TARGET_TYPES };

/**
 * Phase 25 — a new, small, parallel collection to the existing AuditLog, not a schema change to it.
 * AuditLog.restaurantId is required (every entry is restaurant-scoped) and structurally cannot
 * represent agency-only events (agency created, member invited — before any business/restaurant
 * exists in scope). Mirrors the exact reasoning Phase 24 kept BillingWebhookEvent separate from
 * PaymentWebhookEvent despite an identical shape: different domains, unmixed. Business-scoped
 * actions taken by an agency member (e.g. business creation) still ALSO write the normal
 * per-restaurant AuditLog entry — both trails populated, no duplication of concern.
 */
const agencyAuditLogSchema = new Schema(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true },
    action: { type: String, enum: AGENCY_AUDIT_ACTIONS, required: true },
    targetType: { type: String, enum: AGENCY_AUDIT_TARGET_TYPES, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, toJSON: idTransform }
);

agencyAuditLogSchema.index({ agencyId: 1, createdAt: -1 });

export type AgencyAuditAction = (typeof AGENCY_AUDIT_ACTIONS)[number];
export type AgencyAuditTargetType = (typeof AGENCY_AUDIT_TARGET_TYPES)[number];
export type AgencyAuditLogDoc = InferSchemaType<typeof agencyAuditLogSchema> & { _id: Types.ObjectId };
export const AgencyAuditLog = model<AgencyAuditLogDoc>("AgencyAuditLog", agencyAuditLogSchema);
