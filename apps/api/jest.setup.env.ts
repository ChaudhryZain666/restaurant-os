import { config } from "dotenv";

/**
 * Phase 46 — replaces the bare `dotenv/config` setupFiles entry. Loads the developer's real
 * `.env` first (JWT secrets, every other value a real dev environment needs), then re-applies
 * `.env.test` with override:true so MONGO_URI/REDIS_URL specifically point at an isolated test
 * database/Redis-index instead of whatever `.env` configured — see `.env.test`'s own comment for
 * exactly what contamination this eliminates. Every other value (JWT secrets, STRIPE_*, etc.)
 * still comes from `.env` untouched, so no secret needs duplicating into a second file.
 */
config();
config({ path: ".env.test", override: true });
