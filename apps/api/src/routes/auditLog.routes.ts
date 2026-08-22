import { Router } from "express";
import { listAuditLogQuerySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateQuery } from "../middleware/validate.js";
import { listAuditLog } from "../controllers/auditLog.controller.js";

/** Mounted at /restaurants/:restaurantId/audit-log — owner/manager only (restaurant.audit.read). */
export const auditLogRouter = Router({ mergeParams: true });

auditLogRouter.get(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.audit.read"),
  validateQuery(listAuditLogQuerySchema),
  asyncHandler(listAuditLog)
);
