import { Router } from "express";
import { createPrinterSchema, updatePrinterSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { createPrinter, deletePrinter, listPrinters, testPrintPrinter, updatePrinter } from "../controllers/printer.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/printers — mergeParams for :restaurantId.
 *
 * GET is available to anyone tenant-matched at this location (no extra permission) — staff running
 * the register should be able to see which printers exist and what they're for (Section 15: "the
 * restaurant owner/staff should understand which printer does what"). Every mutation — creating,
 * editing, deleting, or test-printing a printer — is configuration, gated to
 * restaurant.printers.manage (owner/manager, and agency_owner/agency_admin's equivalent grant) so
 * front-of-house staff can print but never reconfigure hardware (Section 20).
 */
export const printerRouter = Router({ mergeParams: true });

printerRouter.use(requireAuth, requireTenantMatch());

printerRouter.get("/", asyncHandler(listPrinters));
printerRouter.post("/", requirePermission("restaurant.printers.manage"), validateBody(createPrinterSchema), asyncHandler(createPrinter));
printerRouter.patch("/:printerId", requirePermission("restaurant.printers.manage"), validateBody(updatePrinterSchema), asyncHandler(updatePrinter));
printerRouter.delete("/:printerId", requirePermission("restaurant.printers.manage"), asyncHandler(deletePrinter));
printerRouter.post("/:printerId/test-print", requirePermission("restaurant.printers.manage"), asyncHandler(testPrintPrinter));
