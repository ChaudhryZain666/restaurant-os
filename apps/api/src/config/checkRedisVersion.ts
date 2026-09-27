import type { Redis } from "ioredis";
import { logger } from "../common/logger.js";

/** BullMQ's own hard requirement and recommendation — confirmed directly from
 *  node_modules/bullmq/dist/cjs/classes/redis-connection.js (`RedisConnection.minimumVersion` /
 *  `recommendedMinimumVersion`), not assumed. */
export const BULLMQ_MINIMUM_REDIS_VERSION = "5.0.0";
export const BULLMQ_RECOMMENDED_REDIS_VERSION = "6.2.0";

/** Simple numeric dot-version comparison — sufficient for Redis's own MAJOR.MINOR.PATCH version
 *  string (e.g. "3.0.504", "7.2.4"); Redis versions carry no pre-release/build metadata the way
 *  full semver does, so a naive per-segment numeric compare is correct here. */
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const v = version.split(".").map((n) => parseInt(n, 10) || 0);
  const m = minimum.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(v.length, m.length); i++) {
    const a = v[i] ?? 0;
    const b = m[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

async function getRedisVersion(client: Pick<Redis, "info">): Promise<string | null> {
  try {
    const info = await client.info("server");
    const match = info.match(/redis_version:([^\r\n]+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Phase 82 hardening — production-only hard gate. BullMQ (every background job in this app runs
 * on it: notifications, trial reminders, payment reconciliation, marketplace stuck-event checks,
 * and the entire Phase 81 async menu-import pipeline) hard-requires Redis >= 5.0.0. Before this,
 * an incompatible Redis was handled the SAME way in every environment: index.ts's own
 * uncaughtException/unhandledRejection handlers treat BullMQ's own "Redis version needs to be
 * greater or equal than 5.0.0" error as non-fatal, and background-job registration's own
 * .catch() just logs and continues — both deliberately, correctly, so a stale LOCAL DEV Redis
 * never blocks a developer from testing everything else this app does. Applied unconditionally,
 * that same graceful degradation is a real production hazard: the server would boot, report
 * healthy on /health, and accept requests, while every background job — including every real
 * restaurant's menu import — silently never ran, with no operator-visible signal beyond a log
 * line. This closes that gap for production ONLY: called once at startup (index.ts's main(),
 * right after connectDB()), it does nothing outside production, and in production refuses to
 * start (throws, which main()'s own top-level .catch() already turns into a clear stderr message
 * and a non-zero exit) rather than silently degrading.
 */
export async function assertRedisVersionForProduction(client: Pick<Redis, "info">, nodeEnv: string): Promise<void> {
  if (nodeEnv !== "production") return;

  const version = await getRedisVersion(client);
  if (!version) {
    logger.error("[redis] Could not determine Redis server version at startup — refusing to start in production without confirming BullMQ compatibility.");
    throw new Error("Could not determine Redis server version at startup.");
  }

  if (!isVersionAtLeast(version, BULLMQ_MINIMUM_REDIS_VERSION)) {
    logger.error(
      `[redis] Production requires Redis >= ${BULLMQ_MINIMUM_REDIS_VERSION} for BullMQ (background jobs, notifications, the async menu importer). Found ${version}. Refusing to start.`
    );
    throw new Error(`Incompatible Redis version for production: found ${version}, need >= ${BULLMQ_MINIMUM_REDIS_VERSION}.`);
  }

  if (!isVersionAtLeast(version, BULLMQ_RECOMMENDED_REDIS_VERSION)) {
    logger.warn(
      `[redis] Redis ${version} meets BullMQ's hard minimum (${BULLMQ_MINIMUM_REDIS_VERSION}) but not its recommended minimum (${BULLMQ_RECOMMENDED_REDIS_VERSION}). Not blocking startup, but worth upgrading.`
    );
  }
}
