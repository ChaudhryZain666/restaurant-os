import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { uploadRestaurantImage } from "../controllers/upload.controller.js";

/** Mounted at /restaurants/:restaurantId/uploads — mergeParams to see :restaurantId. Permission
 *  (owner-only for branding vs. owner/manager for menu images) is checked inside the controller
 *  itself, since it depends on the multipart body's `purpose` field. */
export const uploadRouter = Router({ mergeParams: true });

uploadRouter.use(requireAuth, requireTenantMatch());
uploadRouter.post("/", asyncHandler(uploadRestaurantImage));
