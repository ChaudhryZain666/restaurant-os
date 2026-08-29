import { Router } from "express";
import { connectRestaurantPaymentAccountSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import {
  connectRestaurantPaymentAccount,
  connectStripeConnect,
  disconnectRestaurantPaymentAccount,
  getRestaurantPaymentAccount,
  syncStripeConnectStatus,
} from "../controllers/restaurantPaymentAccount.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/payment-account. Reuses `restaurant.payments.manage` — the
 * same permission the refund route already gates on (payment.routes.ts) — rather than inventing a
 * new one: a BYOC credential is strictly more sensitive than a refund action, so the existing
 * boundary already covers it correctly. That permission is also already deliberately excluded from
 * every agency role (see packages/types/src/types/agencyRbac.ts) — restaurant payments should never
 * be agency-manageable, and that holds here too with no further RBAC work needed.
 */
export const restaurantPaymentAccountRouter = Router({ mergeParams: true });

restaurantPaymentAccountRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.payments.manage"));
restaurantPaymentAccountRouter.get("/", asyncHandler(getRestaurantPaymentAccount));
restaurantPaymentAccountRouter.post(
  "/",
  validateBody(connectRestaurantPaymentAccountSchema),
  asyncHandler(connectRestaurantPaymentAccount)
);
restaurantPaymentAccountRouter.post("/disconnect", asyncHandler(disconnectRestaurantPaymentAccount));
// Phase 37 — Stripe Connect. connect/stripe starts (or resumes) hosted onboarding; sync-stripe-status
// is called once the owner lands back on return_url, re-verifying real capability server-side
// rather than trusting that the redirect itself means onboarding fully completed.
restaurantPaymentAccountRouter.post("/connect/stripe", asyncHandler(connectStripeConnect));
restaurantPaymentAccountRouter.post("/sync-stripe-status", asyncHandler(syncStripeConnectStatus));
