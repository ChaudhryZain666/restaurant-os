import { Router } from "express";
import { inviteStaffSchema, updateStaffSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { inviteStaff, listStaff, resendStaffInvite, updateStaff } from "../controllers/staff.controller.js";

/** Mounted at /restaurants/:restaurantId/staff — mergeParams is required to see :restaurantId. */
export const staffRouter = Router({ mergeParams: true });

staffRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.staff.manage"));
staffRouter.get("/", asyncHandler(listStaff));
staffRouter.post("/", validateBody(inviteStaffSchema), asyncHandler(inviteStaff));
staffRouter.patch("/:id", validateBody(updateStaffSchema), asyncHandler(updateStaff));
staffRouter.post("/:id/resend-invite", asyncHandler(resendStaffInvite));
