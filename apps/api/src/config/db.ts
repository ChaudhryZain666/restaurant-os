import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../common/logger.js";

// Phase 48 — the initial connect was already logged, but nothing observed the connection AFTER
// that: a mid-runtime disconnect (network blip, replica set election) previously produced no
// operator-visible signal at all until individual requests started failing with generic errors.
// Registered once at module load (not inside connectDB()) so it also covers a reconnect that
// happens without connectDB() being called again. Structured logger, not console.*, for the same
// "greppable/alertable like every other operational event" reason as config/redis.ts.
mongoose.connection.on("disconnected", () => logger.warn("[db] MongoDB disconnected — requests will start failing until this recovers"));
mongoose.connection.on("reconnected", () => logger.info("[db] MongoDB reconnected"));
mongoose.connection.on("error", (err: Error) => logger.error("[db] MongoDB connection error", { error: err.message }));

export async function connectDB(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI);
  logger.info("[db] connected to MongoDB");
}
