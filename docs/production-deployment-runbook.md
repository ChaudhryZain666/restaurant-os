# Production deployment runbook (Hostinger VPS)

Phase 87. How GarnishTable gets from a Git commit to the production server, and how to operate it.
Incidents: `docs/incident-runbook.md`. Edge and custom domains: `docs/custom-domains-operations.md`.

```
git push main ──► GitHub Actions: production-images.yml
                    verify   lint · typecheck · tests · shellcheck
                    images   api / web / admin / marketing  ──►  ghcr.io/<owner>/restaurant-os/<svc>:sha-<commit>
                    rehearsal  the real scripts on a simulated server: deploy, broken deploy → auto-rollback,
                               rollback.sh, crashes, Redis outage, daemon restart, backup/restore
                                                     │
person runs "Deploy production" (deploy-production.yml, main only, environment approval)
   or runs deploy.sh over SSH                        │
                                                     ▼
VPS  /opt/garnishtable/repo/infrastructure/production/scripts/deploy.sh sha-<commit>
       1 refuse anything but sha-<40-char commit>
       2 releases/sha-<commit>/ ← infrastructure/production from that same commit (compose + Caddyfile)
       3 docker compose pull; every image's revision label must equal <commit>
       4 ensureIndexes in a one-off container of the new image (additive; old version still serving)
       5 docker compose up -d --wait  →  smoke-test.sh --expect <commit>
       6 healthy → state/current; not healthy → automatic rollback to what was live (exit 2)
```

The production topology (one VPS, Caddy + API + three frontends + optional Redis; MongoDB Atlas) is
unchanged from Phases 85–86: one API process serves HTTP, Socket.IO, the BullMQ worker and every
scheduled job. Never run two API containers.

## 1. Rules

- **Images are built only by CI.** The server has no build tooling path: `docker-compose.yml` has no
  `build:` sections (local builds use `docker-compose.build.yml`).
- **Only immutable tags are deployed:** `sha-<full commit>`. No `latest`, no branch tags. The running
  commit is always visible: `GET https://api.<domain>/health/live` → `data.version.commit`, each
  frontend's `/version.json`, and `docker inspect` label `org.opencontainers.image.revision`.
- **Secrets live only on the server**, in `/opt/garnishtable/config/{edge,api}.env` (mode 600),
  and in GitHub environment secrets for the deploy SSH key. Never in Git, images or CI logs.
  `VITE_*` values compiled into frontend bundles are public hostnames only.
- **Nothing destructive runs on deploy.** Indexes are additive; the plan seed and demo storefront
  are idempotent and run only with `--init`.

## 2. Server layout

```
/opt/garnishtable/
  repo/                  clone of the repository (scripts, and each release's compose + Caddyfile)
  config/edge.env        hostnames, ACME e-mail, registry, Redis profile + password, alert URL   600
  config/api.env         API secrets (template: apps/api/.env.production.example)               600
  releases/sha-<c>/      infrastructure/production as committed at <c>; newest 6 kept
  state/current          "<tag> <registry>" now live
  state/previous         the rollback target
  state/history.log      every deploy / rollback / failure / backup, with image digests
  state/failed-*.log     diagnostics from failed deploys                                         600
  backups/               MongoDB dumps + Caddy certificate archives                              700
```

Docker volumes (project `garnishtable`): `garnishtable_caddy_data` (certificates and ACME keys,
**never delete**), `garnishtable_caddy_config`, `garnishtable_redis_data` (with local Redis).

## 3. One-time setup

### 3.1 Decisions and accounts needed first (founder)

| Item | Needed for | Notes |
|---|---|---|
| Hostinger VPS, Ubuntu 24.04 | everything | KVM 2 (2 vCPU / 8 GB / 100 GB NVMe) is a comfortable start; the stack idles well under 1 GB (rehearsal measures it). KVM 1 (4 GB) works with local Redis and the 2 GB swap file `bootstrap.sh` adds. Enable Hostinger's weekly VPS snapshots. |
| Domain + DNS access | TLS, all hostnames | §3.6 |
| MongoDB Atlas cluster | data | §3.7 |
| Redis: on the VPS or managed | sessions, rate limits, jobs | §3.8 |
| SMTP provider | all e-mail | §3.9 |
| Object storage (S3-compatible) | uploads | required in production (`STORAGE_*`) |
| Paddle production account | billing | `PADDLE_ENV=production` is enforced at boot when `BILLING_PROVIDER=paddle` |
| Alert channel | alerts | Slack/Discord webhook or ntfy topic → `ALERT_WEBHOOK_URL` (ntfy: also `ALERT_WEBHOOK_FORMAT=ntfy`, plus `ALERT_WEBHOOK_TOKEN` for a protected topic) |
| External uptime monitor | "the whole server is down" | UptimeRobot / Better Stack / Hostinger monitoring on `https://api.<domain>/health` |
| Off-site backup target | backups that survive the VPS | any rclone remote (Backblaze B2, S3, R2…) |

### 3.2 First login and an operator account

From your computer (replace `<ip>`):

```bash
ssh root@<ip>                                  # Hostinger's initial root password or key
adduser deploy && usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# paste YOUR public key (cat ~/.ssh/id_ed25519.pub on your computer):
nano /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
```

Test from a second terminal: `ssh deploy@<ip>` then `sudo -v`. Keep the root session open until it works.

### 3.3 Bootstrap (Docker, firewall, layout)

```bash
ssh deploy@<ip>
curl -fsSL https://raw.githubusercontent.com/ChaudhryZain666/restaurant-os/main/infrastructure/production/scripts/bootstrap.sh -o bootstrap.sh
less bootstrap.sh                      # read what it does
sudo bash bootstrap.sh https://github.com/ChaudhryZain666/restaurant-os.git deploy [<commit>]   # commit: until Phase 87 is on main
```

It installs Docker Engine + Compose from Docker's repository, sets daemon-wide log rotation
(json-file 10 MB × 5) and `live-restore`, enables unattended security upgrades, adds a 2 GB swap file
if none exists, enables UFW (inbound 22/tcp, 80/tcp, 443/tcp, 443/udp only) and fail2ban for SSH,
creates `/opt/garnishtable`, clones the repository and installs (but does not enable) the systemd
timers. Log out and back in so `deploy` gets the `docker` group. If the repository is made private,
clone with a read-only deploy key instead of the HTTPS URL.

**Docker and UFW:** ports published by Docker bypass UFW's rules. That is why the compose file is
the real control for container ports: only Caddy publishes anything (80, 443, 443/udp). MongoDB is
external, Redis and the API's TLS-check port are on private Docker networks.

### 3.4 SSH hardening (key-only)

```bash
sudo bash /opt/garnishtable/repo/infrastructure/production/scripts/harden-ssh.sh check deploy
sudo bash /opt/garnishtable/repo/infrastructure/production/scripts/harden-ssh.sh apply deploy
```

`check` changes nothing. `apply` refuses unless `deploy` has a key and sudo; it disables password
and root login, validates with `sshd -t` before reloading, and keeps your session. **Before closing
that session**, log in from a second terminal (`ssh deploy@<ip>`). If it fails, undo from the open
session: `sudo rm /etc/ssh/sshd_config.d/10-garnishtable.conf && sudo systemctl reload ssh`.

### 3.5 Configuration

```bash
cd /opt/garnishtable
cp repo/infrastructure/production/.env.example config/edge.env
cp repo/apps/api/.env.production.example config/api.env
chmod 600 config/*.env
nano config/edge.env      # hostnames, ACME_EMAIL, GT_COMPOSE_PROFILES, REDIS_PASSWORD, ALERT_WEBHOOK_URL
nano config/api.env       # MONGO_URI, REDIS_URL, JWT_*, SMTP_*, STORAGE_*, providers…
```

- Generate secrets on the server, e.g. `openssl rand -hex 32` (JWT secrets, `REDIS_PASSWORD`),
  `openssl rand -base64 32` (`CREDENTIAL_ENCRYPTION_KEY`; never rotate it without a migration).
- Origins, `TRUST_PROXY`, `CUSTOM_DOMAIN_*`, `NODE_ENV` and `PORT` are set by compose from
  `edge.env`. Don't duplicate them in `api.env`.
- With local Redis: `REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379`.

Registry access. **As of Phase 87 the four GHCR packages are public** (they inherited the public
repository's visibility; anonymous pulls succeed). No secret is baked into any image, and the
source is public anyway, so this is safe, and the server can pull without logging in. If you make
them private (GitHub → Packages → each package → Settings → Change visibility), create a token with
**only `read:packages`** for the server, then:

```bash
echo '<token>' | docker login ghcr.io -u <github-username> --password-stdin
```

(The token is stored in `~/.docker/config.json` of the deploying user; `chmod 600` it.)

### 3.6 DNS checklist

All records point at the VPS IPv4 (`A`) and, if the VPS has one, IPv6 (`AAAA`). If you don't add
`AAAA`, make sure no stale `AAAA` exists: Let's Encrypt prefers IPv6.

| Name | Type | Value |
|---|---|---|
| `garnishtable.com` (apex, marketing) | A / AAAA | VPS |
| `www.garnishtable.com` | A / AAAA (or CNAME → `garnishtable.com`) | VPS. **Required:** Caddy serves it as a 301 redirect to `https://garnishtable.com` (`WWW_HOST`), and the deploy waits for its certificate. |
| `app`, `agency`, `admin`, `pos`, `order`, `api` | A / AAAA | VPS |
| `domains` (the restaurant CNAME target) | A / AAAA | VPS |
| `garnishtable.com` | CAA (optional) | `0 issue "letsencrypt.org"` |
| mail records | TXT/MX | SPF, DKIM, DMARC as your SMTP provider specifies (§3.9) |

Check before the first deploy (Let's Encrypt validates over HTTP-01 on port 80):
`for h in garnishtable.com {www,app,agency,admin,pos,order,api,domains}.garnishtable.com; do echo "$h $(dig +short A $h) $(dig +short AAAA $h)"; done`
should print the VPS address for every name. For a dress rehearsal on the real server, set
`ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`, then switch back and
`docker volume rm garnishtable_caddy_data` **only** while still on staging certificates.

### 3.7 MongoDB Atlas checklist

- Cluster in the region nearest the VPS. M0 (free) works for launch but has no Atlas backups;
  `backup.sh` dumps are then your only backups: configure the off-site copy. Paid tiers: enable
  Cloud Backup.
- A dedicated database user with `readWrite` on the GarnishTable database only. Put the database
  name in the URI path (`…mongodb.net/garnishtable?retryWrites=true&w=majority`).
- Network Access: allow **only the VPS IP** (remove `0.0.0.0/0`).
- The API needs a replica set for transactions. Atlas is always one.

### 3.8 Redis: decision

| | On the VPS (`GT_COMPOSE_PROFILES=local-redis`) | Managed (Upstash, Redis Cloud…) |
|---|---|---|
| Cost | none | free tiers are too small for BullMQ's polling; paid ~US$10+/month |
| Latency | sub-millisecond, private network, no internet route | network round trip per job / session write |
| Durability | AOF on `garnishtable_redis_data`; dies with the VPS | provider-managed |
| BullMQ | Redis 7, `noeviction` (required) | must be Redis ≥ 6.2 with `noeviction`; some providers restrict `CLIENT` commands (the smoke test's worker count needs `CLIENT LIST`) |

**Recommendation:** Redis on the VPS. Its contents are refresh sessions, rate-limit counters and
queued jobs. Losing them logs users out and drops in-flight notifications, but no business data,
which lives in MongoDB. This is a founder decision; switching later is just a `REDIS_URL` change.

### 3.9 SMTP checklist

- Hostinger VPS (like most clouds) may block outbound port 25. Use the provider's submission port:
  **587 (STARTTLS)** or **465 (TLS)**. Test from the VPS:
  `openssl s_client -starttls smtp -connect <smtp-host>:587 -crlf -quiet </dev/null | head -3` (or
  `openssl s_client -connect <smtp-host>:465`).
- `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  `EMAIL_FROM=GarnishTable <no-reply@garnishtable.com>`, `CONTACT_NOTIFICATION_EMAIL` = a real inbox.
- Add the provider's SPF include, DKIM keys and a DMARC record for the sending domain.

### 3.10 First deploy

Wait for a green **Production images** run on `main`, then (on the server):

```bash
cd /opt/garnishtable/repo && git fetch --quiet origin && git checkout --quiet --detach <commit>
infrastructure/production/scripts/deploy.sh sha-<commit> --init
```

`--init` adds the idempotent first-deploy steps (plan catalog, `demo-restaurant` storefront). Then,
once:

```bash
docker compose -p garnishtable exec -e PLATFORM_ADMIN_EMAIL=<you> -e PLATFORM_ADMIN_PASSWORD='<strong>' \
  api node dist/scripts/bootstrapPlatformAdmin.js
sudo systemctl enable --now garnishtable-healthwatch.timer garnishtable-backup.timer garnishtable-cleanup.timer
infrastructure/production/scripts/backup.sh          # first backup, and proof it works
infrastructure/production/scripts/smoke-test.sh --public --expect <commit>   # through real DNS
```

Then add the external uptime monitor (`https://api.garnishtable.com/health`, keyword `"status":"ok"`,
every 1–5 minutes).

## 4. Routine deploy

**From GitHub (recommended):** Actions → **Deploy production** → Run workflow (branch `main`) → tag
`sha-<commit>` → approve (environment `production`). The job checks the images exist, SSHes in, checks
out that commit's scripts and runs `deploy.sh`. Setup once: environment `production` with required
reviewers and secrets `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY` (a key used only for deploys,
in `deploy`'s `authorized_keys`) and `PROD_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <ip>`, verified
against the server's own fingerprint).

**By hand:** as in §3.10, without `--init`.

Result codes: `0` live and healthy · `2` the new version failed and the previous one was restored
automatically (investigate `state/failed-*.log`) · `1` failed and nothing healthy could be restored
(see the incident runbook).

Expect about 20–40 s without the API while its container is replaced: a single instance can't be
swapped without a gap. Clients reconnect Socket.IO automatically. Deploy at quiet times.

## 5. Rollback

```bash
infrastructure/production/scripts/rollback.sh                  # to state/previous
infrastructure/production/scripts/rollback.sh sha-<commit>     # to a specific earlier deployment
```

Uses images already on the server (the cleanup timer always keeps the live, previous and three
latest deployed tags), so it works with GitHub or the registry down. Health and smoke checks run as
for a deploy. **Data is not rolled back:** indexes are additive and old code ignores new fields, but a
release that migrated data needs its own plan (incident runbook §4).

## 6. What is running?

```bash
cat /opt/garnishtable/state/current                 # tag + registry
tail /opt/garnishtable/state/history.log            # what happened when, with image digests
curl -s https://api.garnishtable.com/health/live    # {"data":{"version":{"commit":…,"builtAt":…}}}
curl -s https://garnishtable.com/version.json       # each frontend: {"app":…,"commit":…}
docker compose -p garnishtable ps
infrastructure/production/scripts/smoke-test.sh --expect <commit>
```

## 7. Backups and restore

- `backup.sh` (timer: daily 03:15 UTC): `mongodump` via the official `mongo:7` image (the API image
  intentionally has no database tools) → `backups/mongo-<time>.archive.gz`, plus the Caddy certificate
  store. Keeps 14 days (`GT_BACKUP_KEEP_DAYS`). Copies off-server with `GT_BACKUP_OFFSITE_CMD`. Without
  it the log says so on every run. Archives contain customer data and TLS private keys; they are
  created mode 600 in a 700 directory.
- **Verify a backup** without touching production:
  `restore.sh backups/mongo-<time>.archive.gz --to-db restore_check`, inspect, then drop
  `restore_check` in Atlas.
- **Replace production** (destructive, incident runbook §4):
  `GT_RESTORE_CONFIRM='replace <db>' restore.sh <archive> --replace-production`.
- Hostinger VPS snapshots cover the server itself (config, certificates, local Redis).
- **Verify a backup without writing to Atlas** (what the 24 Oct 2026 audit did): start a throwaway
  `mongo:7` container on an `--internal` Docker network, `mongorestore --archive --gzip
  --nsInclude='restaurant_platform.*'` the archive into it (read it with `sudo cat`, the files are
  root-only), compare per-collection counts with production, then remove the container and network.

### Off-site backups

`backup.sh` runs `GT_BACKUP_OFFSITE_CMD` with the dump's path appended, so it must point at
`scripts/offsite-copy.sh <remote>` — a bare `rclone copy …` would read the file as the destination.
`offsite-copy.sh` runs rclone from its official image (nothing installed on the host) and only ever
copies one file; retention on the remote side is the bucket's lifecycle rule.

1. Create a bucket at the chosen provider (separate from DigitalOcean, so one compromised account
   can't delete both the server and its backups), an access key limited to that bucket, and a
   lifecycle rule (e.g. delete after 90 days; object lock/versioning if offered).
2. Write `/opt/garnishtable/config/rclone.conf` (mode 600): an S3-type remote for the bucket, and a
   `crypt` remote named `offsite` on top of it, so the provider stores only encrypted dumps. Keep the
   crypt passwords in your password manager too — without them the copies can't be decrypted.
3. In `edge.env`: `GT_BACKUP_OFFSITE_CMD=/opt/garnishtable/repo/infrastructure/production/scripts/offsite-copy.sh offsite:`
4. Run `backup.sh` once by hand; expect `off-site copy OK` in its output, then list the remote.
5. Test a restore from the off-site copy (download, decrypt with rclone, restore into a throwaway
   container as above).

The systemd units run scripts from `/opt/garnishtable/repo`, which deploys don't move: update that
checkout (`git -C /opt/garnishtable/repo fetch && git -C /opt/garnishtable/repo checkout <commit>`)
to pick up script changes such as this one.

## 8. Monitoring

- `garnishtable-healthwatch.timer` (every 5 min) runs the smoke test plus disk (>85 %), memory
  (<200 MB available), load (>2× CPUs), restart loops (≥3) and certificate expiry (<14 days), and posts
  to `ALERT_WEBHOOK_URL` only when the state changes. `journalctl -u garnishtable-healthwatch` shows
  every run.
- `deploy.sh`, `backup.sh` failures alert immediately.
- The external uptime monitor covers what an on-host check cannot (server or network down).
- Logs: `docker compose -p garnishtable logs --tail 200 api` (rotated at 10 MB × 5 per container; the
  daemon default applies the same to anything else).
- Background jobs: `docker compose -p garnishtable exec api node dist/scripts/queueStatus.js`.

## 9. Disk and resources

- Images: `cleanup-images.sh` (weekly) removes GarnishTable images except the live, previous and three
  most recent deployed tags, then dangling layers. Each image set is about 0.6–0.8 GB (shared base
  layers). Volumes are never touched.
- Logs are capped (≈50 MB per container); backups pruned at 14 days; releases at 6.
- No container memory limits are set: one API process on a dedicated VPS, and an arbitrary limit
  would turn a spike into an OOM-kill. Watch `docker stats` and the healthwatch memory alert; resize
  the VPS if available memory stays low.

## 10. GitHub settings to apply (one-time)

- Branch protection on `main`: require the **Production images** checks; no force-push.
- Settings → Actions → General: "Fork pull request workflows" require approval. No workflow here
  runs on `pull_request`, so fork code never sees registry or deploy credentials.
- Environment `production`: required reviewers; deployment branches: `main` only; the four SSH secrets.
- Workflow permissions default: read-only. The workflows request only `packages: write` (image
  job) / `packages: read` (rehearsal, deploy).
- Packages: currently public (see §3.5); a founder decision whether to make them private.
- **Legal facts for the marketing site (Phase 88), repository variables** (Settings → Secrets and
  variables → Actions → Variables): `GT_LEGAL_ENTITY_NAME`, `GT_LEGAL_JURISDICTION`,
  `GT_LEGAL_CONTACT_EMAIL`, `GT_PRIVACY_CONTACT_EMAIL`, `GT_BILLING_CONTACT_EMAIL`. They are compiled
  into the Terms, Privacy and Refund pages (`apps/marketing/src/lib/legal.ts`). **All five, or none**
  (Phase 89, option C):
  - **None set:** the build continues, and the three pages show only their title and "Legal
    documents are being finalized" (noindexed; no draft text, no placeholders). This is a
    **production-readiness blocker**, kept visible on purpose: a CI warning annotation, a build-log
    warning, `"legalConfigured":false` in `https://<MARKETING_HOST>/version.json`, and a `WARN` line
    in `smoke-test.sh`. Paddle's website review needs the real pages, so paid plans stay blocked.
  - **Some set, a placeholder, or a malformed email:** the build fails (`check-build-env.sh`,
    `apps/marketing/legalConfig.mjs`).

  Every built image is also scanned for leftover placeholder tokens (`check-build-output.sh`).
  Never fill the values with guesses.

## 11. Legal pages: open founder/legal review items (Phase 88)

The published pages never show review markers (they render only in local development, through
`apps/marketing/src/components/LegalReviewNote.tsx`), but these passages still need founder/counsel
input before the policies are final:

| Page | Item |
|---|---|
| Terms §14 (limitation of liability) | a specific liability cap |
| Terms §17 (governing law) | final jurisdiction and dispute-resolution mechanism (courts vs. arbitration) |
| Privacy §4 (service providers) | a complete, named subprocessor list |
| Privacy §5 (retention) | retention periods per data category |
| Privacy §8 (international) | hosting region(s) and cross-border transfer mechanism |
| Refund §5 (refunds) | the refund window/policy |

When a passage is finalized, replace its `<LegalReviewNote>` with the approved wording.

## 12. Edge and frontend behaviour notes (Phase 88)

- **Security headers.** Every frontend page and asset carries `Content-Security-Policy`
  (`frame-ancestors`, `object-src 'none'`, `base-uri 'self'`), `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin` (`infrastructure/docker/nginx/<app>.headers.template`).
  Marketing and the portals may only be framed by themselves (`X-Frame-Options: SAMEORIGIN` too).
  The storefront may additionally be framed by the marketing site (live demo) and the four portal
  hosts (live menu preview); `FRAME_ANCESTORS` is derived from the hostnames in `docker-compose.yml`.
  The CSP deliberately has no `script-src`/`connect-src`, so API calls, Socket.IO and Paddle are
  unaffected. The API sets its own (stricter) headers via helmet.
- **No HTTP downgrades / directory listings.** nginx uses relative redirects
  (`absolute_redirect off`), and a URL naming a `public/` folder (e.g. `/v3`, `/menu-images`) is an
  application route, served `index.html`.
- **Readiness is `GET /health`** (503 when MongoDB or Redis is down); liveness is `GET /health/live`.
  There is no `/ready` endpoint and nothing references one.
- **Unknown frontend paths return HTTP 200** with the app's own not-found page and
  `noindex, nofollow`. The routes are client-side (and the storefront/portals have dynamic routes such
  as `/r/:slug`, `/orders/:id`), so nginx cannot know which paths exist without duplicating every
  router table; search engines honour the `noindex`.
- **Expected anonymous request:** on page load the storefront and portals call `POST /auth/refresh`
  once to restore a session from the httpOnly cookie (which scripts cannot see); a visitor without a
  session gets 401. This is the session-restore mechanism, not an error.
