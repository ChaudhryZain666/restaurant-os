import { config } from "dotenv";
import { assertSafeTestEnvironment, blockExternalFetch } from "./src/test-utils/testEnvironmentGuard.js";

/**
 * Phase 46 — replaces the bare `dotenv/config` setupFiles entry. Loads the developer's real
 * `.env` first (JWT secrets, every other value a real dev environment needs), then re-applies
 * `.env.test` with override:true so MONGO_URI/REDIS_URL specifically point at an isolated test
 * database/Redis-index instead of whatever `.env` configured — see `.env.test`'s own comment for
 * exactly what contamination this eliminates. Every other value (JWT secrets, STRIPE_*, etc.)
 * still comes from `.env` untouched, so no secret needs duplicating into a second file.
 *
 * Phase 89 — `.env.test` also pins BILLING_PROVIDER=mock and blanks the PADDLE_* credentials;
 * override:true makes those win over a value inherited from the invoking shell too. The guard then
 * refuses to run any test if the database isn't a local *_test one or billing could reach Paddle,
 * and blocks any fetch to a non-local host that a test didn't fake.
 */
config();
config({ path: ".env.test", override: true });
assertSafeTestEnvironment(process.env);
blockExternalFetch(globalThis);
