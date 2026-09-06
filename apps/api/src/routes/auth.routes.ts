import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  acceptInviteSchema,
  changePasswordSchema,
  confirmEmailChangeSchema,
  deleteMeSchema,
  loginSchema,
  registerSchema,
  requestEmailChangeSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import { inviteResendLimiter } from "../middleware/inviteResendLimiter.js";
import { validateBody } from "../middleware/validate.js";
import {
  acceptInvite,
  changePassword,
  confirmEmailChange,
  deleteMe,
  login,
  logout,
  me,
  refresh,
  register,
  requestEmailChange,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  startDemoSession,
  updateMe,
  verifyEmail,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

// Tighter than the app-wide limiter (app.ts) — these are the classic brute-force/enumeration
// targets (credential guessing, reset-spam). 30/15min is generous enough for normal use and
// repeated local testing while still meaningfully throttling automated abuse. The limit itself is
// env.AUTH_RATE_LIMIT_MAX (defaults to this exact 30) — see its own doc comment in config/env.ts
// for why: a full local Playwright run's aggregate login traffic can exceed this from a single
// shared IP even though no real client ever would, and that's a test-infrastructure concern to
// override locally, never a reason to change what a real deployment enforces.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

// Public storefront playground (Phase 32) — tighter than authLimiter since each call mints a
// permanent-until-cleanup DB row rather than just checking credentials; 20/15min/IP is generous
// for a single visitor genuinely trying the demo while still bounding junk-account creation.
const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

authRouter.post("/register", authLimiter, validateBody(registerSchema), asyncHandler(register));
authRouter.post("/login", authLimiter, validateBody(loginSchema), asyncHandler(login));
authRouter.post("/demo-session", demoLimiter, asyncHandler(startDemoSession));
authRouter.post("/refresh", asyncHandler(refresh));
authRouter.post("/logout", asyncHandler(logout));
authRouter.post(
  "/request-password-reset",
  authLimiter,
  validateBody(requestPasswordResetSchema),
  asyncHandler(requestPasswordReset)
);
authRouter.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), asyncHandler(resetPassword));
authRouter.post("/accept-invite", authLimiter, validateBody(acceptInviteSchema), asyncHandler(acceptInvite));
authRouter.post("/verify-email", authLimiter, validateBody(verifyEmailSchema), asyncHandler(verifyEmail));
authRouter.post("/resend-verification", requireAuth, inviteResendLimiter, asyncHandler(resendVerification));
authRouter.get("/me", requireAuth, asyncHandler(me));
authRouter.patch("/me", requireAuth, validateBody(updateProfileSchema), asyncHandler(updateMe));
authRouter.post(
  "/change-password",
  requireAuth,
  authLimiter,
  validateBody(changePasswordSchema),
  asyncHandler(changePassword)
);
authRouter.post(
  "/request-email-change",
  requireAuth,
  authLimiter,
  validateBody(requestEmailChangeSchema),
  asyncHandler(requestEmailChange)
);
authRouter.post(
  "/confirm-email-change",
  authLimiter,
  validateBody(confirmEmailChangeSchema),
  asyncHandler(confirmEmailChange)
);
authRouter.delete("/me", requireAuth, authLimiter, validateBody(deleteMeSchema), asyncHandler(deleteMe));
