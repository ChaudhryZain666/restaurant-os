import { Router } from "express";
import { createPosOrderSchema, createPosTerminalPaymentSchema, mockCompleteTerminalPaymentSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { createPosOrder, listPendingSales } from "../controllers/pos.controller.js";
import {
  cancelTerminalPayment,
  createTerminalPayment,
  getTerminalPaymentStatus,
  mockCompleteTerminalPayment,
} from "../controllers/posTerminalPayment.controller.js";
import { env } from "../config/env.js";
import { mockDriversAllowed } from "../config/mockDrivers.js";

/** Mounted at /restaurants/:restaurantId/pos — mergeParams for :restaurantId. Every route here is
 *  staff-only (never public — unlike table resolution, there's no anonymous POS caller), gated on
 *  the new restaurant.pos.operate permission (owner/manager/staff, not kitchen_staff — see
 *  packages/types/src/types/rbac.ts). */
export const posRouter = Router({ mergeParams: true });

posRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.pos.operate"));

posRouter.post("/orders", validateBody(createPosOrderSchema), asyncHandler(createPosOrder));
// Phase 75 — recoverable/abandoned POS sales for this location. See pos.controller.ts's
// listPendingSales for the exact filter and docs/pos-architecture.md's Phase 75 section.
posRouter.get("/pending-sales", asyncHandler(listPendingSales));

// Phase 74 — physical card-terminal payment attempts. All three inherit this router's own
// requireTenantMatch()/restaurant.pos.operate gate above; owner/manager/staff can all reach them,
// kitchen_staff cannot, same as every other POS action — no new permission was introduced.
posRouter.post(
  "/orders/:orderId/terminal-payment",
  validateBody(createPosTerminalPaymentSchema),
  asyncHandler(createTerminalPayment)
);
posRouter.get("/orders/:orderId/terminal-payment/:paymentId", asyncHandler(getTerminalPaymentStatus));
posRouter.post("/orders/:orderId/terminal-payment/:paymentId/cancel", asyncHandler(cancelTerminalPayment));

// Only exists at all when the mock terminal provider is active — same "the route itself doesn't
// exist otherwise" discipline as routes/payment.routes.ts's own mock-complete route.
if (env.POS_TERMINAL_PROVIDER === "mock" && mockDriversAllowed(env.NODE_ENV)) {
  posRouter.post(
    "/orders/:orderId/terminal-payment/:paymentId/mock-complete",
    validateBody(mockCompleteTerminalPaymentSchema),
    asyncHandler(mockCompleteTerminalPayment)
  );
}
