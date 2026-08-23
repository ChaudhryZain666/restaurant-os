import type { Types } from "mongoose";
import { AgencyAuditLog, type AgencyAuditAction, type AgencyAuditTargetType } from "../models/AgencyAuditLog.js";
import { logger } from "../common/logger.js";

interface RecordAgencyAuditEventInput {
  agencyId: string | Types.ObjectId;
  actorUserId: string | Types.ObjectId;
  actorRole: string;
  action: AgencyAuditAction;
  targetType: AgencyAuditTargetType;
  targetId: string | Types.ObjectId;
  metadata?: Record<string, unknown>;
}

/**
 * Phase 25 — the agency-scoped counterpart to audit.service.ts's recordAuditEvent, same "never
 * fail the real operation" philosophy: a failure to WRITE an audit entry must never fail the real
 * action it's describing, errors are caught and logged, not propagated.
 */
export async function recordAgencyAuditEvent(input: RecordAgencyAuditEventInput): Promise<void> {
  try {
    await AgencyAuditLog.create({
      agencyId: input.agencyId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    });
  } catch (err) {
    logger.error("failed to record agency audit event", { action: input.action, error: (err as Error).message });
  }
}
