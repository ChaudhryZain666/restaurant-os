import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "../common/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

/**
 * Phase 48 — full lifecycle visibility, not just errors. This client backs refresh-token issuance
 * (token.service.ts) — the previous audit's own finding was that a Redis outage degrades
 * gracefully (existing access tokens keep working) but produced no operator-visible signal that it
 * was happening at all. "error" alone under-reports this: ioredis retries internally and may not
 * emit "error" for a while, but "close"/"reconnecting" fire immediately on a dropped connection —
 * exactly the earliest honest signal that new logins/refreshes are currently failing. Structured
 * logger (not console.*) so this is greppable/alertable the same way every other operational event
 * in this codebase already is.
 */
redis.on("connect", () => logger.info("[redis] connected"));
redis.on("ready", () => logger.info("[redis] ready"));
redis.on("close", () => logger.warn("[redis] connection closed — new logins/refreshes will fail until this recovers"));
redis.on("reconnecting", (delayMs: number) => logger.warn("[redis] reconnecting", { delayMs }));
redis.on("error", (err: Error) => logger.error("[redis] error", { error: err.message }));
