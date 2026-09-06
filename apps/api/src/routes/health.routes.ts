import { Router } from "express";
import mongoose from "mongoose";
import { redis } from "../config/redis.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../common/response.js";

export const healthRouter = Router();

/**
 * Phase 48 — liveness: "is the process itself running and able to respond at all," independent of
 * any external dependency. A deployment platform's restart-on-failed-liveness policy should only
 * ever fire for a genuinely wedged/dead process, never because MongoDB or Redis happen to be
 * temporarily unreachable — restarting the API container does nothing to fix a database outage,
 * it just adds a cold-start on top of it. Never fails as long as the event loop can still handle
 * an HTTP request; carries no dependency checks and nothing to redact.
 */
healthRouter.get("/live", (_req, res) => {
  sendSuccess(res, { status: "ok" });
});

/**
 * Readiness: "can this instance safely serve production traffic right now." MongoDB is a hard
 * requirement (every request touches it). Redis is included too — deliberately, not by oversight:
 * unlike BullMQ/rate-limiting (which already degrade gracefully without it, see queues/connection.ts
 * and rateLimitHandler.ts), session issuance (token.service.ts's issueRefreshToken) writes to Redis
 * synchronously on every login/register/refresh with no fallback — when Redis is down, no new
 * session can be created or renewed at all, which is exactly the kind of "can this instance safely
 * serve traffic" question readiness exists to answer. An already-issued access token keeps working
 * for its own remaining lifetime (JWT verification never touches Redis), so this is never "the
 * whole app is down," but it is genuinely "don't route new traffic here if avoidable."
 *
 * Public (mounted before requireAuth in app.ts) but deliberately minimal — connection state only,
 * never a connection string, credential, or config value. See docs/operations-monitoring.md for
 * what a production deployment should point at this endpoint.
 */
healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const mongoUp = mongoose.connection.readyState === 1;

    let redisUp = false;
    try {
      redisUp = (await redis.ping()) === "PONG";
    } catch {
      redisUp = false;
    }

    const status = mongoUp && redisUp ? "ok" : "degraded";
    sendSuccess(res, { status, dependencies: { mongo: mongoUp ? "up" : "down", redis: redisUp ? "up" : "down" } }, status === "ok" ? 200 : 503);
  })
);
