import { Router } from "express";
import { createTableSchema, updateTableSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createTable,
  deleteTable,
  getTableQr,
  listTables,
  regenerateTableQr,
  resolveTable,
  updateTable,
} from "../controllers/table.controller.js";

/** Mounted at /restaurants/:restaurantId/tables — mergeParams for :restaurantId. */
export const tableRouter = Router({ mergeParams: true });

// Public: a customer scanning a QR isn't authenticated yet. Mounted before the auth-gated routes
// below so it never accidentally picks up requireAuth from a shared router-level `.use()`.
tableRouter.get("/resolve/:token", asyncHandler(resolveTable));

tableRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.tables.manage"));

tableRouter.get("/", asyncHandler(listTables));
tableRouter.post("/", validateBody(createTableSchema), asyncHandler(createTable));
tableRouter.patch("/:tableId", validateBody(updateTableSchema), asyncHandler(updateTable));
tableRouter.delete("/:tableId", asyncHandler(deleteTable));
tableRouter.get("/:tableId/qr", asyncHandler(getTableQr));
tableRouter.post("/:tableId/regenerate-qr", asyncHandler(regenerateTableQr));
