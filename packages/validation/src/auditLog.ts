import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@restaurant/types";
import { paginationQueryShape } from "./pagination.js";

export const listAuditLogQuerySchema = z.object({
  ...paginationQueryShape,
  targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
  targetId: z.string().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorUserId: z.string().optional(),
  // Plain "YYYY-MM-DD" from a date input — startDate is inclusive from midnight, endDate
  // inclusive through the end of that day (see auditLog.controller.ts's filter construction).
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
});
export type ListAuditLogQueryInput = z.infer<typeof listAuditLogQuerySchema>;
