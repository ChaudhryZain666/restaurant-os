import type { Types } from "mongoose";
import { AuditLog, type AuditAction, type AuditTargetType } from "../models/AuditLog.js";
import { logger } from "../common/logger.js";

interface RecordAuditEventInput {
  restaurantId: string | Types.ObjectId;
  actorUserId: string | Types.ObjectId;
  actorRole: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | Types.ObjectId;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget in spirit but awaited in practice: a failure to WRITE an audit entry must never
 * fail the real operation it's describing (a refund that succeeded but couldn't be logged is
 * still a refund that succeeded) — errors are caught and logged, not propagated.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  try {
    await AuditLog.create({
      restaurantId: input.restaurantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    });
  } catch (err) {
    logger.error("failed to record audit event", { action: input.action, error: (err as Error).message });
  }
}
