# Incident runbook

Phase 87. For the production VPS described in `docs/production-deployment-runbook.md`. Commands run
on the server as the operator user from `/opt/garnishtable/repo/infrastructure/production`; `dc`
below is shorthand for `docker compose -p garnishtable`.

**First five minutes, whatever the symptom:**

```bash
scripts/smoke-test.sh                      # which parts fail (PASS/FAIL per check)
dc ps -a                                   # what's running, health, restarts
tail -20 /opt/garnishtable/state/history.log   # was anything deployed recently?
df -h / ; free -m ; uptime
dc logs --tail 100 api                     # then caddy / web / redis as needed
```

If a deploy happened in the last hour and the problem started with it: **roll back first, diagnose
second**: `scripts/rollback.sh`.

## 1. Site down / errors everywhere

| Finding | Action |
|---|---|
| Containers missing after a reboot | `systemctl status docker`; `sudo systemctl start docker`. Containers have `restart: unless-stopped`; if one was stopped by hand, `scripts/deploy.sh $(cut -d' ' -f1 /opt/garnishtable/state/current) --pull-missing --skip-indexes` restores the recorded deployment. |
| `api` restarting / unhealthy | `dc logs --tail 200 api`. Config error at boot (missing/invalid env var) → fix `config/api.env`, then `dc up -d api` via the redeploy command above. Bad release → `scripts/rollback.sh`. |
| `/health` 503, `mongo: down` | Atlas status page; Atlas → Network Access still allows the VPS IP? Credentials rotated? `MONGO_URI` correct? The API reconnects by itself once reachable. |
| `/health` 503, `redis: down` | Local: `dc ps redis`, `dc logs redis`; `dc up -d redis`. Disk full stops AOF writes (see §5). Managed: provider status. Logins/refreshes fail while Redis is down; existing access tokens keep working. |
| Caddy not running / port 80/443 refused | `dc logs caddy`. Caddyfile error after a change → roll back. Port conflict → `sudo ss -ltnp 'sport = :443'`. |
| Everything healthy on the server but users can't reach it | Run `scripts/smoke-test.sh --public` from your own computer; check DNS (`dig`), Hostinger panel (VPS suspended? network firewall?), UFW (`sudo ufw status`). |

## 2. Deploy failed

- Exit **2**: the new version never became healthy and the previous one was restored automatically.
  Production is fine. Read `/opt/garnishtable/state/failed-<tag>-<time>.log` (compose state + last API
  and Caddy logs), fix, ship a new commit.
- Exit **1** at the start (tag refused, commit not found, image missing, revision mismatch, disk):
  nothing was changed; the old version is still serving. Fix the cause and re-run.
- Exit **1** after "ROLLBACK FAILED": treat as §1. Try an older known-good tag from `history.log`:
  `scripts/rollback.sh sha-<older>`.
- "another deployment is in progress": a deploy is running, or one was killed. Check
  `pgrep -af deploy.sh`; the lock is released automatically when the process exits.

## 3. Background jobs not running

Symptoms: no order e-mails, trial reminders/expiry not applied, demo data piling up.

```bash
dc exec api node dist/scripts/queueStatus.js
# {"redisVersion":"7.x","workers":1,"schedules":[…"demo.cleanup_tick"…],"counts":{…,"failed":N}}
```

- `workers: 0`: the in-process worker lost Redis; check Redis (§1), then restart the API
  (`dc restart api`; ~20 s outage).
- Schedules missing: they are re-registered at every API start; restart the API.
- `failed` growing: `dc logs api | grep -i 'job failed'` for the job name and error.
- Never start a second API container to "add a worker": the architecture is a single instance
  (Socket.IO has no Redis adapter, and scheduled jobs assume one worker).

## 4. Data problems: restore

1. Stop writes: `dc stop api` (the site shows errors; better than writing to bad data).
2. Back up the current state first, even if damaged: `scripts/backup.sh`.
3. Restore into a scratch database and inspect:
   `scripts/restore.sh /opt/garnishtable/backups/mongo-<time>.archive.gz --to-db restore_check`.
4. Either copy specific documents back by hand, or replace everything:
   `GT_RESTORE_CONFIRM='replace <db>' scripts/restore.sh <archive> --replace-production`.
5. `dc start api`, then `scripts/smoke-test.sh`. Drop `restore_check` in Atlas.

On a paid Atlas tier, Atlas point-in-time restore is usually better than a nightly dump. Everything
written after the dump you restore is lost; tell affected restaurants.

## 5. Disk full

```bash
df -h / ; docker system df ; du -sh /opt/garnishtable/backups
scripts/cleanup-images.sh                  # keeps live/previous/recent images
sudo journalctl --vacuum-size=200M
```

Container logs are capped at ~50 MB each. If backups dominate, lower `GT_BACKUP_KEEP_DAYS` (only
when the off-site copy works). Never `docker volume prune`: `garnishtable_caddy_data` holds every
certificate and ACME key.

## 6. Certificates

- A fixed hostname shows a certificate error: `dc logs caddy | grep -iE 'error|acme'`. Usually DNS
  doesn't point here (Let's Encrypt validates over port 80) or a rate limit was hit after the
  certificate volume was lost. See `docs/custom-domains-operations.md` §4–5.
- A restaurant's custom domain has no certificate: run the ask check from Caddy's container,
  `dc exec caddy wget -qSO- "http://api:4001/internal/tls/ask?domain=<their-domain>"`. A 403 means
  the platform says no (not verified/active, subscription not entitled); a 503 means the API couldn't
  decide (MongoDB down).

## 7. Server compromised or lost

1. Rotate everything in `config/api.env` and `edge.env` at the source (Atlas user password, JWT
   secrets (all users are logged out), SMTP, storage keys, Paddle/Stripe keys, Redis password), the
   GHCR read token, the deploy SSH key (GitHub environment secret) and your own SSH key if exposed.
   `CREDENTIAL_ENCRYPTION_KEY` can't be rotated without re-encrypting stored restaurant
   credentials; restaurants must re-enter their payment keys if it leaked.
2. Build a fresh VPS from `docs/production-deployment-runbook.md` §3 (an hour or two), deploy the
   last good tag from `history.log` (or the latest green `main` build), restore the Caddy certificate
   archive into `garnishtable_caddy_data` before the first start to avoid re-issuing every
   certificate, and move DNS.
3. Atlas data is unaffected by losing the VPS; local Redis contents are lost (sessions: users log in
   again).

## 8. After any incident

Write down what happened, when, impact, and what will prevent it, and add the check that would have
caught it to `smoke-test.sh` or `healthwatch.sh`.
