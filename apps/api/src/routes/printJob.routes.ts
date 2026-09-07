import { Router } from "express";
import { createPrintJobSchema, updatePrintJobStatusSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { createPrintJob, getPrintJob, listPrintJobsForOrder, retryPrintJob, updatePrintJobStatus } from "../controllers/printJob.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/print-jobs — mergeParams for :restaurantId. Gated on
 * restaurant.orders.read — the exact same permission the existing /print/:mode/:id page already
 * requires (App.tsx), so anyone who could already open that page and print via the browser can also
 * use the tracked print-job flow; this phase doesn't narrow or widen who can print.
 */
export const printJobRouter = Router({ mergeParams: true });

printJobRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.orders.read"));

printJobRouter.post("/", validateBody(createPrintJobSchema), asyncHandler(createPrintJob));
printJobRouter.patch("/:jobId", validateBody(updatePrintJobStatusSchema), asyncHandler(updatePrintJobStatus));
printJobRouter.post("/:jobId/retry", asyncHandler(retryPrintJob));
printJobRouter.get("/by-order/:orderId", asyncHandler(listPrintJobsForOrder));
printJobRouter.get("/:jobId", asyncHandler(getPrintJob));
