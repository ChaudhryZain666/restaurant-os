import rateLimit from "express-rate-limit";
import { jsonRateLimitHandler } from "./rateLimitHandler.js";

/**
 * Phase 29 audit finding P1-4 — the four authenticated invite-resend endpoints (agency business
 * owner, agency member, restaurant staff, platform-created restaurant owner) had no throttling at
 * all. Each is gated by a real permission check, so this isn't the anonymous-brute-force case
 * auth.routes.ts's tighter limiter exists for — it's guarding against an authorized-but-compromised
 * (or simply careless) admin account spamming one invitee's inbox via repeated resends. Keyed by
 * the default IP-based generator, same as every other limiter in this codebase.
 */
export const inviteResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
