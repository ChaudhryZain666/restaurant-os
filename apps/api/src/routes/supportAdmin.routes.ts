import { Router } from "express";
import { assignTicketSchema, updateTicketPrioritySchema, updateTicketStatusSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import {
  assignTicket,
  getSupportAnalytics,
  listAdminTickets,
  updateTicketPriority,
  updateTicketStatus,
} from "../controllers/support.controller.js";

/** Platform-wide ticket management — platform_admin only, not tenant-scoped. Mounted at /support/admin. */
export const supportAdminRouter = Router();

supportAdminRouter.use(requireAuth, requireRole("platform_admin"));
supportAdminRouter.get("/tickets", requirePermission("support.tickets.read"), asyncHandler(listAdminTickets));
supportAdminRouter.patch(
  "/tickets/:id/status",
  requirePermission("support.tickets.write"),
  validateBody(updateTicketStatusSchema),
  asyncHandler(updateTicketStatus)
);
supportAdminRouter.patch(
  "/tickets/:id/priority",
  requirePermission("support.tickets.write"),
  validateBody(updateTicketPrioritySchema),
  asyncHandler(updateTicketPriority)
);
supportAdminRouter.patch(
  "/tickets/:id/assign",
  requirePermission("support.tickets.assign"),
  validateBody(assignTicketSchema),
  asyncHandler(assignTicket)
);
supportAdminRouter.get("/analytics", requirePermission("support.analytics.read"), asyncHandler(getSupportAnalytics));
