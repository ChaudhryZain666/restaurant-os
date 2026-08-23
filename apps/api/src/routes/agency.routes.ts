import { Router } from "express";
import { createAgencyBusinessSchema, createAgencySchema, paginationQuerySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAgencyMatch, requireAgencyPermission } from "../middleware/agency.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  createAgency,
  createAgencyBusiness,
  getAgency,
  getAgencyAuditLog,
  getMyAgencies,
  listAgencyBusinesses,
} from "../controllers/agency.controller.js";

export const agencyRouter = Router();

agencyRouter.use(requireAuth);

agencyRouter.post("/", validateBody(createAgencySchema), asyncHandler(createAgency));
agencyRouter.get("/me", asyncHandler(getMyAgencies));

agencyRouter.get("/:agencyId", requireAgencyMatch(), asyncHandler(getAgency));
agencyRouter.get(
  "/:agencyId/businesses",
  requireAgencyMatch(),
  validateQuery(paginationQuerySchema),
  asyncHandler(listAgencyBusinesses)
);
agencyRouter.post(
  "/:agencyId/businesses",
  requireAgencyMatch(),
  requireAgencyPermission("agency.businesses.manage"),
  validateBody(createAgencyBusinessSchema),
  asyncHandler(createAgencyBusiness)
);
agencyRouter.get(
  "/:agencyId/audit-log",
  requireAgencyMatch(),
  validateQuery(paginationQuerySchema),
  asyncHandler(getAgencyAuditLog)
);
