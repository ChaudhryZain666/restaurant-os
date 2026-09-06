# Production Monitoring, Alerting & Background Job Reliability (Phase 48)

This documents what the application itself now does to make production failures visible, and —
just as important — what a production deployment still has to configure externally to turn that
visibility into an actual page/alert to a human. Nothing below replaces the need for a real
uptime monitor and log-based alerting once this is actually deployed; the goal of this phase was
to make sure the application *emits the right signals* for that layer to consume, not to build
that layer itself (no external alerting service exists in this repo, and none was fabricated).

## Health model: liveness vs readiness

Two endpoints, two different questions:

- **`GET /health/live`** — "is the process itself alive and able to respond at all?" No dependency
  checks. Always `200` if the event loop can handle the request. A deployment platform's
  restart-on-failed-liveness policy should point here — restarting the API container fixes a
  genuinely wedged process, but does nothing for a database outage, so a dependency check has no
  business gating a restart decision.
- **`GET /health`** — "can this instance safely serve production traffic right now?" Checks MongoDB
  (`mongoose.connection.readyState`) and Redis (`PING`). Returns `200` with `{status: "ok"}` when
  both are up, `503` with `{status: "degraded", dependencies: {...}}` otherwise. A load balancer or
  uptime monitor should point here.

**Why Redis is a readiness dependency, not just BullMQ's backing store:** it would be tempting to
drop Redis from readiness on the theory that the app already degrades gracefully without it
(BullMQ and rate-limiting both do — see below). But `token.service.ts`'s `issueRefreshToken` writes
every login/register/refresh's session to Redis synchronously, with no fallback path. When Redis is
down, no new session can be created or renewed at all — that's exactly the "can this instance
safely take new traffic" condition readiness exists to catch. An already-issued access token keeps
working (JWT verification never touches Redis), so this is never "the whole app is down," but new
logins genuinely fail. Both endpoints are deliberately public (mounted before `requireAuth`) but
return only up/down status — never a connection string, credential, or config value.

Neither endpoint should be treated as a full-platform admin dashboard — see `GET /platform/config`
below for the one place slightly deeper (but still curated, still non-secret) diagnostics live,
gated by `platform_admin`.

## Redis, MongoDB, and BullMQ connection visibility

`config/redis.ts`, `queues/connection.ts`, and `config/db.ts` now log structured lifecycle events
(`connect`, `ready`, `close`, `reconnecting`, `error` for Redis/BullMQ's connection;
`disconnected`/`reconnected`/`error` for Mongoose) via the shared `logger`. Previously these were
either unlogged or a plain `console.log`. The point: graceful degradation (the app not crashing
when Redis blips) must not become *silent* degradation — an operator watching logs should be able
to see "Redis connection closed" happen, not just infer it later from a spike in failed logins.

## BullMQ / notification queue

One queue (`notifications`), several job families (order lifecycle, ticket events, billing
lifecycle, trial-reminder tick, payment-reconciliation tick, delivery-dispatch). Per the phase's
own audit questions:

- **Retention** — `defaultJobOptions: { removeOnComplete: { count: 1000 }, removeOnFail: { count:
  5000 } }`. Previously unset, meaning BullMQ's default (keep everything forever) applied — fine
  for debuggability, unbounded for Redis memory over a real production lifetime. Bounded by count
  (job volume), not age, since that's what actually drives memory here.
- **Stalled-job detection** — `worker.on("stalled", ...)` now logs a `warn`. A stalled job (BullMQ's
  lock on it expired mid-processing — almost always because the worker process crashed or hung
  while holding it) previously produced no signal until it eventually became a `failed` job once
  BullMQ's retry budget was exhausted. This doesn't change retry/failure behavior — it only makes
  an already-happening condition observable earlier.
- **Failure visibility** — the existing `worker.on("failed", ...)` listener now also logs the job
  `name`, not just its id and the error, so a failure log line is actually actionable without a
  separate Redis lookup.
- **Idempotency / no invented retries** — deliberately **not** changed this phase. Order/billing
  notification emails are fire-and-forget with failures logged, never thrown, and never wrapped in
  a new retry — adding automatic retries to a non-idempotent "send an email" job would risk
  duplicate emails, which the phase brief explicitly forbids inventing. The one place BullMQ's own
  job-level retry already existed (repeatable ticks like the trial-reminder sweep) already has its
  own DB-level idempotency guard (`trialEndingReminderSentAt`, atomically claimed via
  `findOneAndUpdate`) — unchanged, and correct.
- **Graceful worker shutdown** — `notificationWorker.close()` is called during the shutdown sequence
  below and is now properly awaited as part of a bounded, non-reentrant shutdown (previously it ran
  concurrently with an un-awaited `httpServer.close()` and had no timeout).
- **Inspectability** — `GET /platform/config` (platform_admin only) now also returns
  `notificationQueueHealth`: waiting/active/delayed/failed/completed job **counts** only (never job
  payloads, which could carry order/customer detail this diagnostics endpoint has no business
  exposing). If the queue can't be reached (e.g. Redis down, or — see the note below — an
  incompatible Redis version), this degrades to `null` rather than failing the whole config
  response; the admin `SystemConfigPage` shows a "counts unavailable" note rather than crashing.

**Known pre-existing environment note, not a Phase 48 regression:** this repo's dev/test Redis is
version 3.0.504; BullMQ 5 requires >= 5.0.0. `index.ts` already has a narrow, well-understood
non-fatal carve-out for this exact error (`isKnownNonFatalQueueError`) so the API still starts and
serves requests, but it means BullMQ operations (including the new job-count read above) genuinely
fail in this environment until Redis is upgraded. This is a local/test-environment limitation, not
something this phase introduced or could fix without changing the Redis version — a real production
Redis should be >= 5.0.0.

## Webhook signature-failure logging

Payment webhooks (`paymentWebhook.controller.ts`, all three entry points: shared-secret, per-account
BYOC, and centralized Stripe Connect) and the billing webhook (`billingWebhook.controller.ts`) now
log a `warn` (`"webhook signature verification failed"` / `"billing webhook signature verification
failed"`) before rejecting an invalid signature with `400`. Previously invisible: the global error
handler (`errorHandler.ts`) only logs `>= 500` responses, so a misconfigured secret or a genuine
forged request never appeared in application logs at all, regardless of which it was. Logged as
`warn`, not `error` — a rejected bad signature is correctly-handled, not a server fault — but a
*recurring* one is worth an operator's attention (rotated/misconfigured secret on the provider's
side). Never logs the signature header or raw request body.

## Logging & redaction

Structured JSON logging (`common/logger.ts`) is unchanged in shape
(`{timestamp, level, message, ...meta}`, routed to `console.log/warn/error` by level). Redaction
was hardened from exact key-name matching to case-insensitive **substring** matching across a fixed
word list (`password`, `token`, `secret`, `authorization`, `cookie`, `apikey`) — closing a real gap
where a compound field name like `smtpPassword`, `stripeSecretKey`, `webhookSecret`, `clientSecret`,
or `apiKey` would previously pass through unredacted. Deliberately still a small, fixed list — not a
blanket "anything that looks sensitive" heuristic, which would make legitimate diagnostic fields
(`orderId`, `restaurantId`, `jobId`, `durationMs`, ...) unreadable. Covered by
`common/logger.test.ts` (exact-match, compound-key, nested-object/array, and non-redaction cases).

Never logged anywhere in this codebase, verified during this audit: SMTP passwords, Stripe/Safepay/
Paddle secrets, JWT secrets, full auth tokens, payment credentials, webhook signatures/raw bodies.

## Graceful shutdown

`index.ts`'s `shutdown()` now:

1. Guards against a second SIGTERM/SIGINT arriving mid-shutdown (previously a double signal would
   run the whole teardown sequence twice, concurrently).
2. Actually awaits `httpServer.close()` via its callback (previously fire-and-forget, meaning "stop
   accepting new connections" was requested but never confirmed before tearing down Mongo/Redis).
3. Then closes the notification worker (lets its current in-flight job finish), then Redis, then
   the BullMQ connection.
4. Is bounded by a 10-second hard deadline — if any step hangs (e.g. a stuck in-flight job), the
   process force-exits with code 1 rather than hanging forever, so the deployment platform's own
   supervisor can restart it.

No new shutdown framework — this is the same five-step sequence the brief describes (stop new work
→ let in-flight settle → stop workers → close Mongo/Redis → close HTTP server → exit), hardened in
place.

## Process-level failure handling

Unchanged from the existing, narrow `uncaughtException`/`unhandledRejection` carve-out
(`isKnownNonFatalQueueError` in `index.ts`) — only the one specific, well-understood BullMQ
Redis-version-incompatibility error is treated as non-fatal; everything else still crashes the
process (correctly — an unrecognized uncaught exception leaves process state unknown, and
swallowing it generically would risk the process staying apparently healthy after it no longer is).

## Docker healthcheck

`docker-compose.yml`'s `api` service now has a `healthcheck` block (mongo and redis already had
one; api didn't). Uses `node -e` against `require('http')` rather than `curl`/`wget`, since the
`node:22-slim` base image (`infrastructure/docker/api.Dockerfile`) doesn't reliably have either
installed. Points at `/health/live` (liveness), not `/health` (readiness) — deliberately: Docker's
healthcheck is what an orchestrator would use to decide whether to restart the container, and
restarting `api` because Mongo/Redis happen to be briefly down would add a restart loop on top of
an already-degraded dependency without fixing anything.

## What's implemented vs what a production deployment must still configure

**Implemented (this phase, application-side):**
- Liveness/readiness endpoints with correct dependency semantics.
- Structured connection-lifecycle logging for Mongo, Redis, and the BullMQ connection.
- Stalled/failed job logging, bounded job retention.
- Webhook signature-failure logging (payment + billing).
- Hardened log redaction.
- Hardened, bounded, re-entrancy-safe graceful shutdown.
- A queue-health diagnostic surfaced through the existing `platform_admin`-gated `/platform/config`
  endpoint and its admin UI.
- A Docker healthcheck for the `api` service.

**Still externally pending (no fabricated service — these require real production
infrastructure/credentials this repo doesn't have and shouldn't invent):**
- An actual uptime monitor (e.g. a platform's built-in health check, or an external service) polling
  `/health` and `/health/live` and paging someone on failure.
- Log-based alerting rules wired to the `warn`/`error` lines this phase adds or already exists —
  concretely, at minimum:
  - **Critical**: `/health` returning `503` for a sustained period; repeated process
    crash-and-restart (a real uncaughtException/unhandledRejection that isn't the known non-fatal
    carve-out); MongoDB unreachable; sustained Redis failure (new logins/refreshes failing);
    notification worker not processing (queue backlog growing with no matching completions).
  - **Important**: repeated `"notification job failed"` / `"webhook signature verification failed"`
    log lines in a short window; repeated order/billing notification email failures; delivery
    provider failures.
  These are log **contents** to alert on, not a new metrics pipeline — whatever log-aggregation
  tool the production deployment uses (this repo has none configured) needs a rule matching on
  `level: "error"`/`"warn"` plus the relevant `message` text.
- A real production Redis at version >= 5.0.0 (this repo's dev/test Redis is 3.0.504 — see above).
- Real SMTP/Stripe/Safepay/Paddle/delivery-provider credentials and their own dashboards' delivery/
  webhook-failure monitoring (this repo already surfaces failures on receipt; it cannot monitor a
  provider's own outbound delivery pipeline it has no visibility into).
