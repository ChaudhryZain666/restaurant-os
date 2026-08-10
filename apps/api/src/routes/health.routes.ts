import { Router } from "express";
import mongoose from "mongoose";
import { redis } from "../config/redis.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../common/response.js";

export const healthRouter = Router();

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
