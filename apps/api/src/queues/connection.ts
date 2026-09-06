import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

/** BullMQ requires its own Redis connection with maxRetriesPerRequest: null. */
export const queueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Without this, an unhandled 'error' event on this EventEmitter (ioredis's own contract) crashes
// the whole process — not just this queue. That turned a local/environment-only problem (an
// incompatible or unreachable Redis) into a full API outage in practice, e.g. BullMQ's own
// minimum-version check throwing on connect. config/redis.ts's sibling client already guards the
// same way; this one didn't. Background jobs genuinely won't run without a working queue
// connection — that's still true and still logged — but the HTTP API itself must stay up.
queueConnection.on("error", (err: Error) => logger.error("[queue] redis connection error", { error: err.message }));
// Phase 48 — same "graceful degradation must not be silent" reasoning as config/redis.ts: a
// dropped queue connection means no order/trial/billing notification can be enqueued or processed
// until it recovers (existing jobs already in Redis aren't lost, just not being worked), which is
// worth an explicit operator-visible signal, not just a later error the moment something tries to
// use it.
queueConnection.on("close", () => logger.warn("[queue] redis connection closed — background jobs are not being enqueued or processed"));
queueConnection.on("reconnecting", (delayMs: number) => logger.warn("[queue] redis reconnecting", { delayMs }));
queueConnection.on("ready", () => logger.info("[queue] redis ready"));
