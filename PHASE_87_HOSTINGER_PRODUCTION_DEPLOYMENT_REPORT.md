# Phase 87 — Hostinger Production Deployment Infrastructure

Branch `phase-87-hostinger-deployment` (from Phase 86 at `2920be7`), commits `8ec2446` … final report
commit. `main` was not changed. No real server, DNS, Atlas cluster, SMTP account or payment
credential was touched.

## 1. Status

**`COMPLETE WITH EXTERNAL INPUTS`**: the real-server deployment itself is **BLOCKED** on server
access.

The whole pipeline exists and has been verified end to end on GitHub Actions:

1. A commit is verified: lint, typecheck, 1739/1739 API tests, web/admin/utils tests, shellcheck.
2. Four images are built once in CI and pushed to GHCR, tagged `sha-<full commit>`.
3. A **simulated server** pulls those exact images and runs the real server scripts: deploy,
   version-to-version upgrade, a broken deploy with automatic rollback, operator rollback and
   roll-forward, crashes, a Redis outage, a Docker daemon restart, and backup/restore.
   **56/56 checks passed** (run 37146508757).
4. The Phase 86 edge/custom-domain harness re-ran against the new image-only compose split:
   **81/81** (run 37142279052).

Not done, because they need inputs only the founder can provide (section 9):

- a deployment to the Hostinger VPS (there is no access to one);
- real Let's Encrypt certificates, DNS, Atlas, SMTP and storage.

Exact bootstrap commands are in section 10 and in `docs/production-deployment-runbook.md`.

**Image set to deploy:** `sha-2a117e1e8d92843c26301c250f75f5ae387db258`. It is the newest image set
that passed the full rehearsal. The commit adding this report changes only documentation and the
workflow trigger, so it produces no images.

## 2. Architecture: unchanged

- One VPS runs Caddy, a single API instance (HTTP, Socket.IO, BullMQ worker and all scheduled
  jobs), the three nginx frontends, and optional Redis. MongoDB stays on Atlas.
- No worker split, no Socket.IO Redis adapter, no Kubernetes, no Cloudflare for SaaS, no provider
  change.
- Phase 86's Caddyfile, on-demand TLS check and the `caddy_data` certificate volume are untouched;
  certificates surviving restarts is re-verified in section 5.
- No architecture-changing decision was needed, so the STOP rule was never triggered.

## 3. What was built

| Area | Files |
|---|---|
| CI: verify → images → rehearsal | `.github/workflows/production-images.yml`. Runs on `main` and `v*` tags, never on `pull_request`. Permissions: `contents: read`, plus `packages: write` only for the image job. GHA layer cache. |
| Manual production deploy | `.github/workflows/deploy-production.yml`. `workflow_dispatch` only, `main` only, `production` environment (meant to have required reviewers). Checks the tag format and that the images exist; SSH with a pinned `known_hosts` file, never trust-on-first-use. |
| Image-only compose | `infrastructure/production/docker-compose.yml`: `${GT_IMAGE_REGISTRY}/<svc>:${GT_IMAGE_TAG:?}`, no `build:`. Local and harness builds use `docker-compose.build.yml`. |
| Traceability | Each image carries the OCI `revision`/`created` labels. `GET /health` and `/health/live` return `version.commit` and `builtAt`; each frontend serves `/version.json`. |
| Server scripts | `infrastructure/production/scripts/`: `deploy.sh`, `rollback.sh`, `smoke-test.sh` (PASS/FAIL), `backup.sh`, `restore.sh`, `healthwatch.sh`, `cleanup-images.sh`, `bootstrap.sh`, `harden-ssh.sh`, `lib.sh`. |
| Timers | `infrastructure/production/systemd/`: healthwatch every 5 min, backup daily, image cleanup weekly. |
| Rehearsal | `infrastructure/production/test/deploy-rehearsal.sh`. The test overlay gained overridable Pebble/CA paths and a restart policy for the MongoDB stand-in. |
| API | Demo-data cleanup is now an hourly BullMQ repeatable job (`demo.cleanup_tick`, `services/demoCleanup.service.ts`, 2 tests). `scripts/queueStatus.ts` gives a read-only worker/schedule/Redis snapshot. Health routes report the version. |
| Docs | New: `docs/production-deployment-runbook.md`, `docs/incident-runbook.md`. Updated: `production-architecture.md`, `custom-domains-operations.md`, `production-launch-checklist.md`, `backup-and-recovery.md`, `theme-architecture.md`. Server template: `infrastructure/production/.env.example`. |

### deploy.sh, in order

1. Accepts only `sha-<40 hex>`; `latest`, branch names and short SHAs are refused.
2. Takes a lock, so two deployments can't overlap.
3. Builds `releases/sha-<c>/` from `git archive <c> infrastructure/production`, so the compose file
   and Caddyfile always match the images.
4. Pulls the images and checks every image's revision label equals `<c>`.
5. Runs `ensureIndexes` in a one-off container of the new image while the old version keeps
   serving. `--init` adds the idempotent plan seed and demo storefront.
6. `up -d --wait`, then the smoke test with up to 180 s for certificates.
7. Records the result in `state/current`, `state/previous` and `history.log` (with image digests).
8. On failure, automatically rolls back to what was live and exits `2`. If that also fails, it
   exits `1` and sends an alert.

## 4. Verification evidence

| Run | Commit | Result |
|---|---|---|
| 37128482099 | `8ec2446` | verify failed: 12/1739 tests, a CI-only environment gap (fixed, section 6) |
| 37128959851 | `3b11792` | verify ✅ 1739/1739, images ✅, rehearsal lost its runner (section 6) |
| 37140402381 | `4af2b3e` | images ✅; rehearsal 24 pass / 32 fail (section 6) |
| 37142278966 | `bddb74c` | images ✅; rehearsal failed (diagnosed, section 6) |
| 37142279052 | `bddb74c` | **Phase 86 edge harness on the image-only compose: 81/81** |
| 37144702991 | `b581101` | images ✅; rehearsal failed (smoke-test bug, section 6) |
| **37146508757** | **`2a117e1`** | **verify ✅ (1739/1739 API tests, lint, typecheck, shellcheck), 4 images ✅, rehearsal ✅ 56/56** |

## 5. Rehearsal results (run 37146508757, all 56 PASS)

The simulated server pulled the real GHCR images for `b5811010` (previous) and `2a117e1e` (current).
Only the outside world was simulated: Pebble stood in for Let's Encrypt, challtestsrv for DNS, and
a `mongo:7` replica set for Atlas. Redis 7.4.11 ran through the production `local-redis` profile.

- **Tag safety:**
  - `latest`, `main`, a short SHA, a bare SHA, a malformed tag, and a commit that doesn't exist
    are all refused before anything changes.
- **Deployments:**
  - The previous version was deployed with `--init` (55 s), then the current version over it
    (43 s).
  - `/health/live` reports the deployed commit; `state/previous` holds the rollback target.
  - Indexes were built for 38 models. `--init` seeded 9 plans.
  - Redeploying the live tag is idempotent: data is kept, and the rollback target is kept.
- **Smoke test, 36/36:**
  - all five containers healthy, HTTP→HTTPS, TLS verified on all seven hostnames;
  - API liveness and readiness, each hostname routed to the right app, every component on the
    expected commit;
  - `/api/v1` through the frontend proxies;
  - Socket.IO handshake allowed for the platform origin and refused (403) for an unknown origin;
  - no certificate issued for an unmapped domain;
  - BullMQ worker connected with all schedules, including `demo.cleanup_tick`; Redis 7.4.11; no
    failed jobs.
- **Each container** runs `ghcr.io/chaudhryzain666/restaurant-os/<svc>:sha-2a117e1…`, and its
  revision label matches. History records the image digests.
- **Failed deploy → automatic rollback:**
  - A broken API image (correct label, crashes on start) was reported as failed with exit 2.
  - The good build was restored automatically, `state/current` stayed correct, and diagnostics were
    saved at mode 600.
- **Operator rollback:**
  - `rollback.sh` returned the API **and** the frontends to the previous commit, with the smoke test
    passing.
  - `rollback.sh sha-<current>` rolled forward again.
- **Crashes:** SIGKILL of `api`, `web` and `caddy` → each restarted by Docker and healthy; the smoke
  test passes afterwards.
- **Certificates:** the same certificate serial before and after Caddy's crash, so nothing was
  re-issued.
- **Redis outage:**
  - readiness 503 while liveness stays 200, so the API doesn't enter a restart loop;
  - after Redis returns, readiness is 200 and the BullMQ worker has reconnected.
- **Docker daemon restart** (reboot simulation): all 7 containers came back without intervention;
  the smoke test passes.
- **Backups:**
  - `backup.sh` produced a MongoDB dump and a Caddy certificate archive (mode 600), and the
    connection string never appears in its logs.
  - `restore.sh --to-db` restored 58/58 documents.
  - `--replace-production` refuses without explicit confirmation.
- **Operations scripts:**
  - `healthwatch.sh` reports healthy, and detects a stopped frontend.
  - `cleanup-images.sh` kept the live and rollback images.
- **Exposure:**
  - only Caddy publishes ports; the `backend` network is internal;
  - log rotation (json-file 10m × 5) is applied to the containers, verified on `caddy`, `api` and
    `web`;
  - the API runs as `node`, not root.
- **Measured idle memory:**
  - API 87 MiB, Caddy 16 MiB, each nginx about 4.4 MiB, Redis 9 MiB; about 125 MiB for the
    production stack, excluding the MongoDB stand-in;
  - images 3.3 GB on disk for two image sets plus third-party images.

## 6. Defects found by the verification, all fixed

1. **CI test environment.** The Stripe Connect tests need `STRIPE_SECRET_KEY` to be set; every
   Stripe call in them is stubbed. The auth tests exceed the default rate limit. CI now gets a
   placeholder key and the test-only limit overrides a developer `.env` already has. Not a code
   defect.
2. **Unsafe crash test.** The rehearsal's crash test could run `sudo kill -9 0`: a container that
   is restarting reports PID 0, and that command signals the whole process group. This is the
   likely reason one run lost its runner. It is now guarded.
3. **Hostname leak (a real deploy risk).** Compose lets shell variables override `--env-file`. CI's
   workflow-wide `MARKETING_HOST`/`APP_HOST`/… leaked into the simulated server, and Caddy requested
   certificates for the production names. On a real server, an operator's stray `export APP_HOST=…`
   would do the same. `gt_compose` now removes every key `edge.env` defines from the environment
   before running Compose, and CI sets those variables only on the build job.
4. **Smoke test kept a stale HTTP status.** It captured responses with `$(req …)`, a subshell, so
   the status stayed `308` while the bodies were correct.
5. **Certificate backup couldn't start.** It mounted the volume at `/data` in the `mongo` image,
   which declares its own volumes there.
6. **No wait for certificates.** `deploy.sh` judged a deploy before Caddy had time to obtain them;
   it now waits up to 180 s (`--wait`).
7. **Unsafe cleanup.** `cleanup-images.sh` would delete every image when no live deployment was
   recorded; it now refuses.
8. **MongoDB stand-in didn't restart.** It had no restart policy, so the daemon-restart test would
   have failed for a reason Atlas never would.

## 7. Requirements checklist

| Requirement | Result |
|---|---|
| CI-only builds, immutable SHA tags, never `latest`, traceable to a commit | ✅ verified |
| Secrets never committed, baked, logged or bundled | ✅ Server config (mode 600, warned if looser). CI values are generated per run and masked. Images carry no `.env` (Phase 85B scan). Frontends get public hostnames only. |
| Ubuntu 24.04, Docker + Compose, UFW 22/80/443, SSH key-only | ⚠️ `bootstrap.sh` and `harden-ssh.sh` were written and syntax/shellcheck-checked, **not executed**: no Ubuntu server is available, and CI runners can't safely run them. SSH hardening is two-step: `check`, then `apply` (validated with `sshd -t`, session kept open, second login tested before closing). |
| Private networks, `ports:` review | ✅ Only Caddy publishes ports. API 4000/4001, nginx and Redis are private; `backend` is internal. Docker bypassing UFW is documented. |
| Log rotation, actually applied | ✅ per service (verified) and as a daemon default (`bootstrap.sh`) |
| Disk cleanup keeps rollback images | ✅ verified |
| Resources (no arbitrary limits) | ✅ measured, documented, plus a memory/disk/load watch |
| Env strategy, existing names kept | ✅ `edge.env` (hostnames, registry, profiles) plus `api.env` (the existing `.env.production.example` names) |
| GHCR security | ⚠️ Minimal token permissions ✅. **Packages are public** (inherited from the public repo; anonymous pull returns 200); a founder decision (section 9). |
| `deploy <TAG>`: validate, pull, verify, start, health, smoke | ✅ verified |
| Rollback with a previous immutable tag, tested | ✅ automatic and operator rollback both verified |
| "Which SHA is running?" | ✅ `/health/live`, `/version.json`, labels, `state/current`, `history.log` |
| Indexes per deploy, no destructive seeding | ✅ `ensureIndexes` (additive) every deploy; seed and demo only with `--init`, idempotent |
| Demo-cleanup scheduler | ✅ hourly BullMQ job, verified registered |
| Backup and restore without `mongodump` in the API image | ✅ `mongo:7` tools image, verified |
| Redis decision | 📋 founder decision; recommendation in runbook §3.8 (Redis on the VPS) |
| Atlas, SMTP 465/587, DNS checklists | 📋 runbook §3.6–3.9 |
| Restart and reboot tests | ✅ crash and daemon restart. A real kernel reboot needs a VM. |
| Failure tests: API, frontend, Caddy, worker, Redis, failed deploy | ✅ all verified |
| Monitoring and alerting | ✅ `healthwatch.sh` plus webhook alerts. Webhook delivery was not exercised against a real endpoint. External uptime provider: founder decision. |
| Forked PRs can't deploy; explicit deployment boundary | ✅ no `pull_request` triggers; deploy is manual, `main`-only and environment-gated. ⚠️ `deploy-production.yml` has **not run**: it needs `main`, the environment and the SSH secrets. |
| Runbooks: deployment, incident, architecture | ✅ |
| Real server deployment | ⛔ BLOCKED: no VPS access |

## 8. Tests: honest notes

- **CI:** 1739/1739 API tests, 137 suites, on a clean MongoDB 7 replica set and Redis 7.
- **Local, full parallel run on this Windows machine:** 28 failures in 9 suites, all 5-second
  timeouts plus one dropped Redis connection under load. Those 9 suites pass 87/87 with
  `--runInBand`, and CI passes all of them, so this is local contention, not a code issue.
- **Playwright E2E was not re-run in this phase** (Phase 87 changed no UI). The known pre-existing
  E2E failures stand as recorded in earlier reports and are not masked:
  - `legal-pages`: placeholder legal content, by design until filled;
  - `phase28 loyalty reward redemption`: also failing on the Phase 85B baseline.
- **CI lint:** passes, with the existing unused-variable warnings.
- **Node 20 deprecation:** GitHub warns that `actions/checkout@v4`, `setup-node@v4` and
  `login-action@v3` target Node 20 (forced onto Node 24). Not blocking; bump the action majors when
  convenient.

## 9. Founder decisions and inputs needed

1. **VPS:** Hostinger KVM 2 suggested (KVM 1 works with swap), Ubuntu 24.04, with SSH access for the
   operator.
2. **DNS** for the apex, `app`, `agency`, `admin`, `pos`, `order`, `api` and `domains` → VPS; mail
   records for the SMTP provider.
3. **Redis:** on the VPS (recommended) or managed.
4. **MongoDB Atlas:** tier (M0 has no Atlas backups), database user, network access limited to the
   VPS IP.
5. **SMTP provider** (submission port 587/465), plus SPF, DKIM and DMARC.
6. **Object storage** (S3-compatible) credentials.
7. **Paddle production** credentials when billing goes live.
8. **Alert channel** (`ALERT_WEBHOOK_URL`), an **external uptime monitor**, and an **off-site backup
   target**.
9. **GHCR visibility:** keep public (works without a login; no secrets in images) or make private
   (then the server needs a `read:packages` token).
10. **GitHub settings:**
    - branch protection on `main`;
    - a `production` environment with required reviewers and the four `PROD_SSH_*` secrets;
    - fork PR workflows require approval.
11. **Merge** `phase-87-hostinger-deployment` into `main`. `deploy-production.yml` and the `main`
    pipeline only run from there; until then, deploy by hand with `deploy.sh`.

## 10. Bootstrap commands (summary of runbook §3)

```bash
# 1. as root on the new VPS: operator user with your SSH key
adduser deploy && usermod -aG sudo deploy        # then install ~deploy/.ssh/authorized_keys
# 2. as deploy:
curl -fsSL https://raw.githubusercontent.com/ChaudhryZain666/restaurant-os/phase-87-hostinger-deployment/infrastructure/production/scripts/bootstrap.sh -o bootstrap.sh   # main, once merged
sudo bash bootstrap.sh https://github.com/ChaudhryZain666/restaurant-os.git deploy 2a117e1e8d92843c26301c250f75f5ae387db258
sudo bash /opt/garnishtable/repo/infrastructure/production/scripts/harden-ssh.sh check deploy
sudo bash /opt/garnishtable/repo/infrastructure/production/scripts/harden-ssh.sh apply deploy   # keep the session; test a 2nd login
# 3. configuration (mode 600)
cd /opt/garnishtable && cp repo/infrastructure/production/.env.example config/edge.env \
  && cp repo/apps/api/.env.production.example config/api.env && chmod 600 config/*.env
# 4. first deploy (DNS must already point here)
cd repo && git fetch -q origin && git checkout -q --detach 2a117e1e8d92843c26301c250f75f5ae387db258
infrastructure/production/scripts/deploy.sh sha-2a117e1e8d92843c26301c250f75f5ae387db258 --init
sudo systemctl enable --now garnishtable-healthwatch.timer garnishtable-backup.timer garnishtable-cleanup.timer
```

For a first rehearsal on the real VPS, set `ACME_CA` to the Let's Encrypt staging URL (runbook
§3.6).
