import { Router } from "express";
import {
  createAgencyBusinessSchema,
  createAgencySchema,
  listAgencyBusinessesQuerySchema,
  paginationQuerySchema,
  setAgencyDomainSchema,
  setClientCommercialTermsSchema,
  updateAgencySchema,
  updateBusinessWhiteLabelSchema,
  setAgencyEmailSenderSchema,
} from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAgencyMatch, requireAgencyPermission } from "../middleware/agency.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { inviteResendLimiter } from "../middleware/inviteResendLimiter.js";
import {
  createAgency,
  createAgencyBusiness,
  getAgency,
  getAgencyAuditLog,
  getAgencyBusiness,
  getAgencyDashboard,
  getAgencyLocationDetail,
  getAgencyLocations,
  getMyAgencies,
  listAgencyBusinesses,
  resendAgencyBusinessOwnerInvite,
  setAgencyDomain,
  setClientCommercialTerms,
  updateAgency,
  updateBusinessWhiteLabel,
  getBusinessWhiteLabel,
  setAgencyEmailSender,
  removeAgencyEmailSender,
  verifyAgencyDomain,
} from "../controllers/agency.controller.js";

export const agencyRouter = Router();

agencyRouter.use(requireAuth);

agencyRouter.post("/", validateBody(createAgencySchema), asyncHandler(createAgency));
agencyRouter.get("/me", asyncHandler(getMyAgencies));

agencyRouter.get("/:agencyId", requireAgencyMatch(), asyncHandler(getAgency));
agencyRouter.patch(
  "/:agencyId",
  requireAgencyMatch(),
  requireAgencyPermission("agency.manage"),
  validateBody(updateAgencySchema),
  asyncHandler(updateAgency)
);
agencyRouter.post(
  "/:agencyId/domain",
  requireAgencyMatch(),
  requireAgencyPermission("agency.manage"),
  validateBody(setAgencyDomainSchema),
  asyncHandler(setAgencyDomain)
);
// White-label branded email — a custom sender on the agency's own verified domain. Used only after
// a platform admin confirms it (POST /platform/agencies/:agencyId/email-sender/review).
agencyRouter.put(
  "/:agencyId/email-sender",
  requireAgencyMatch(),
  requireAgencyPermission("agency.manage"),
  validateBody(setAgencyEmailSenderSchema),
  asyncHandler(setAgencyEmailSender)
);
agencyRouter.delete(
  "/:agencyId/email-sender",
  requireAgencyMatch(),
  requireAgencyPermission("agency.manage"),
  asyncHandler(removeAgencyEmailSender)
);
agencyRouter.post(
  "/:agencyId/domain/verify",
  requireAgencyMatch(),
  requireAgencyPermission("agency.manage"),
  asyncHandler(verifyAgencyDomain)
);
agencyRouter.get("/:agencyId/dashboard", requireAgencyMatch(), asyncHandler(getAgencyDashboard));
agencyRouter.get(
  "/:agencyId/businesses",
  requireAgencyMatch(),
  validateQuery(listAgencyBusinessesQuerySchema),
  asyncHandler(listAgencyBusinesses)
);
agencyRouter.post(
  "/:agencyId/businesses",
  requireAgencyMatch(),
  requireAgencyPermission("agency.businesses.manage"),
  validateBody(createAgencyBusinessSchema),
  asyncHandler(createAgencyBusiness)
);
agencyRouter.get("/:agencyId/businesses/:businessId", requireAgencyMatch(), asyncHandler(getAgencyBusiness));
agencyRouter.get("/:agencyId/businesses/:businessId/white-label", requireAgencyMatch(), asyncHandler(getBusinessWhiteLabel));
agencyRouter.put(
  "/:agencyId/businesses/:businessId/white-label",
  requireAgencyMatch(),
  requireAgencyPermission("agency.businesses.manage"),
  validateBody(updateBusinessWhiteLabelSchema),
  asyncHandler(updateBusinessWhiteLabel)
);
agencyRouter.put(
  "/:agencyId/businesses/:businessId/commercial-terms",
  requireAgencyMatch(),
  requireAgencyPermission("agency.businesses.manage"),
  validateBody(setClientCommercialTermsSchema),
  asyncHandler(setClientCommercialTerms)
);
agencyRouter.get(
  "/:agencyId/locations",
  requireAgencyMatch(),
  validateQuery(paginationQuerySchema),
  asyncHandler(getAgencyLocations)
);
agencyRouter.get("/:agencyId/locations/:locationId", requireAgencyMatch(), asyncHandler(getAgencyLocationDetail));
agencyRouter.post(
  "/:agencyId/businesses/:businessId/resend-owner-invite",
  inviteResendLimiter,
  requireAgencyMatch(),
  requireAgencyPermission("agency.businesses.manage"),
  asyncHandler(resendAgencyBusinessOwnerInvite)
);
agencyRouter.get(
  "/:agencyId/audit-log",
  requireAgencyMatch(),
  validateQuery(paginationQuerySchema),
  asyncHandler(getAgencyAuditLog)
);
