import { Router } from "express";
import { createPaymentSchema, mockCompletePaymentSchema, refundPaymentSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { env } from "../config/env.js";
import { createPayment, getPayment, listPayments, refund } from "../controllers/payment.controller.js";
import { mockCompletePayment } from "../controllers/paymentMockDriver.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/orders/:orderId/payments — mergeParams for both parent
 * params. Deliberately NOT gated by requireTenantMatch() at the router level: the customer
 * creating/viewing their own payment is never restaurant-scoped staff (no req.user.restaurantId
 * at all), exactly like order creation/getOrder in order.controller.ts — ownership is checked
 * inside the controller/service instead. Only the staff-only refund action needs (and has) a
 * tenant-match + permission guard.
 */
export const paymentRouter = Router({ mergeParams: true });

paymentRouter.use(requireAuth);

paymentRouter.post("/", validateBody(createPaymentSchema), asyncHandler(createPayment));
paymentRouter.get("/", asyncHandler(listPayments));
paymentRouter.get("/:paymentId", asyncHandler(getPayment));
paymentRouter.post(
  "/:paymentId/refund",
  requireTenantMatch(),
  requirePermission("restaurant.payments.manage"),
  validateBody(refundPaymentSchema),
  asyncHandler(refund)
);

// Only exists at all when the mock provider is active — a deployment configured for a real
// provider has no route here, so "simulate a completed payment" is never even reachable, let
// alone mistakable for a real confirmation.
if (env.PAYMENT_PROVIDER === "mock") {
  paymentRouter.post(
    "/:paymentId/mock-complete",
    validateBody(mockCompletePaymentSchema),
    asyncHandler(mockCompletePayment)
  );
}
