# Production Database Backup & Recovery

Phase 77 — the runbook closing this project's second launch blocker ("no production MongoDB
backup strategy, no restore runbook, no tested restore procedure"). Everything on this page was
actually run this phase, not just written — see §8 for exact evidence.

## 1. Architecture assumptions

This repository's own `docker-compose.yml` runs MongoDB as a single-node replica set
(`--replSet rs0`) inside Docker, with bind-mounted source directories — that is a **development**
topology, not a production one (`NODE_ENV: development` is hardcoded into it). No production Mongo
topology is defined anywhere in this repository, and none should be invented here.

The real production database for this project is a **MongoDB Atlas** cluster (a managed,
externally-hosted MongoDB deployment, configured this session — see `apps/api/.env.production`'s
`MONGO_URI`, which is gitignored and never committed). This matters for two reasons:

- Atlas clusters are **always** replica sets (even the free/shared M0 tier), so the transaction
  requirement documented in `docs/database.md` is already satisfied without any extra setup.
- **Atlas tier determines whether Atlas's own built-in Cloud Backup is available.** Dedicated
  clusters (M10 and above) include automated, continuous, point-in-time backup with no custom
  scripting required — if the production cluster is ever upgraded to a dedicated tier, **enabling
  Atlas's native Cloud Backup should become the primary mechanism**, with everything below kept as
  a documented, tested fallback. Shared/free tiers (M0/M2/M5) do **not** include automated backups
  at all, which is what makes the self-managed procedure below a real, non-optional requirement
  today, not a redundant belt-and-suspenders step.

**This runbook does not assume or claim which tier is currently active.** Confirm the actual tier
in the Atlas dashboard (Clusters → cluster name → tier) before deciding whether Atlas Cloud Backup
is already available.

## 2. Backup mechanism

`apps/api/src/scripts/backupDatabase.ts` (`npm run backup -w apps/api`) wraps the real,
industry-standard `mongodump` tool — not a hand-rolled export. It:

1. Reads the already-configured `MONGO_URI` (whatever `.env`/`.env.production` points at) — no
   duplicated connection setting.
2. Runs `mongodump --uri=<MONGO_URI> --out=<timestamped dir> --gzip`.
3. Writes to `apps/api/backups/<ISO-8601 timestamp>/` (gitignored — see `.gitignore`; a real
   database dump must never be committed).
4. Logs a clean success summary (output path, database name, file count, total size) — **the
   connection URI itself is never logged**, including on failure (see §7).
5. Exits non-zero with a clear, redacted error message if `mongodump` fails for any reason
   (unreachable server, bad auth, disk full) — proven this phase against a genuinely unreachable
   Mongo target (§8).

Requires the [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools)
(`mongodump`/`mongorestore`) to be installed and on `PATH` wherever this script runs — this is a
real operational prerequisite for the production host/CI runner, not something this script can
install for itself.

## 3. Backup schedule (baseline)

**Daily, full backup**, at a low-traffic hour (e.g. 03:00 in the deployment's primary timezone).
This is a sensible production baseline for this project's current scale, not a guarantee that a
higher frequency wouldn't be better — see §9's RPO target for the trade-off this implies.

## 4. Retention policy

| Tier | Retention |
|---|---|
| Daily | 7 days |
| Weekly (every Sunday's daily backup) | 4 weeks |
| Monthly (first day of each month's backup) | 6 months |

This is a practical starting baseline, not a compliance-driven number — **founder/legal decision**
if a specific regulatory retention requirement applies to any category of data this platform
stores (see `docs/commercial-decisions.md` for the parallel "not yet finalized" pattern already
used for refund policy).

## 5. Storage — where backups actually live

Backups must never live only on the same host/volume as the live database, and must never be
committed to this repository (`backups/` is gitignored specifically for this reason).

This project already has a real, configured S3-compatible storage integration
(`STORAGE_ENDPOINT`/`STORAGE_BUCKET`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` — see
`apps/api/.env.example`), currently used for menu/restaurant images. **Reuse that same
provider/account for backup storage** (a separate bucket or key prefix, e.g. `backups/`) rather
than introducing a second storage vendor or a new set of credentials:

```
aws s3 cp --recursive apps/api/backups/<timestamp>/ s3://<backup-bucket>/<timestamp>/ \
  --endpoint-url "$STORAGE_ENDPOINT"
```

This is a **documented manual/cron step**, not a feature built into `backupDatabase.ts` itself —
adding automatic upload would duplicate the AWS SDK dependency this app already carries for a
one-line operational command, which is exactly the "elaborate backup platform" this phase is
scoped to avoid building. Whatever schedules `npm run backup` (§9) should run this command
immediately afterward.

Requirements this storage location must meet:
- Outside the primary MongoDB data directory/instance (satisfied — it's a different provider
  entirely from Atlas).
- Access-controlled — a dedicated bucket/prefix with credentials scoped to it, not the same broad
  key used for public menu-image uploads if that can be reasonably separated.
- Geographically/provider-separated from the primary database where practical — an S3-compatible
  bucket is already infrastructure-separate from Atlas.

## 6. Restore procedure

`apps/api/src/scripts/restoreDatabase.ts` (`npm run restore -w apps/api`) is the only supported
restore path. It is deliberately hard to point at the wrong place by accident:

- **`--target-uri` is a required argument the operator must type out explicitly.** The script
  never reads `MONGO_URI` from the environment as a restore target — reusing that pattern here
  (the way `backupDatabase.ts` reuses it for reading) would let a restore silently land on
  whatever database happens to be configured, which is exactly the accidental-overwrite risk this
  runbook exists to prevent.
- **`--target-db` is also required**, and the restore always uses `mongorestore --nsFrom/--nsTo` to
  explicitly rename onto it — a bare directory-based restore silently recreates a database with
  the SAME NAME as the original dump regardless of what the connection URI's own path says, which
  is a real mistake this phase's own testing caught and fixed (§8).
- **`--confirm` is required** on every invocation.
- If `--target-uri` + `--target-db` together exactly match this environment's own configured
  `MONGO_URI`/database (i.e., a real restore-over-production), a second, separately-named flag
  (`--i-understand-this-overwrites-the-configured-database`) is required on top of `--confirm`.
  Missing any of these four things aborts immediately with a clear explanation — nothing is ever
  restored "by default."

### Step by step

1. **Obtain a backup.** Either the most recent local `apps/api/backups/<timestamp>/` directory, or
   download the relevant dated folder from the backup bucket (§5) back to a local path.
2. **Verify the backup exists and looks real** before doing anything else:
   ```
   ls apps/api/backups/<timestamp>/<database-name>/
   ```
   Expect to see `.bson.gz`/`.metadata.json.gz` pairs for every collection you'd expect
   (`businesses`, `users`, `subscriptions`, `orders`, `payments`, `menuitems`, `categories`, ...).
   Zero files, or a suspiciously small total size, means investigate before proceeding — do not
   restore an empty or truncated dump over anything.
3. **Restore into a disposable/non-production database first — never directly into production**,
   even during a real incident, unless production is already down and there is nothing left to
   protect:
   ```
   npm run restore -w apps/api -- --from=apps/api/backups/<timestamp> \
     --target-uri="mongodb://<a-safe-target-host>" \
     --target-db="<database>_restore_test" --confirm
   ```
4. **Verify the restored data** (§7 gives the exact checks) before trusting it for anything.
5. **Verify application connectivity** — point a local `MONGO_URI` at the restored database and
   confirm the real API process (or at minimum, its Mongoose models) can connect and query it
   without error.
6. **Only once 3-5 are all green**, and only for a genuine disaster-recovery scenario (the
   configured production database is actually gone/corrupted, not merely "let's see if this
   works"), repeat the restore with the real production `--target-uri`/`--target-db` and the
   explicit override flag from above. Before doing this: confirm with whoever else operates this
   deployment, and confirm there is a fresh backup of whatever currently exists in production
   (even a broken production database should usually be backed up once more before being
   overwritten, in case the restore itself goes wrong).

### What NOT to do

- Do not restore directly into the production `--target-uri` as your first attempt at using this
  script, ever.
- Do not skip step 2 (verifying the backup itself looks real) because a step feels slow during an
  incident — restoring a bad backup over a partially-working production database is worse than
  taking two extra minutes to check first.
- Do not delete the previous production data before confirming the restore succeeded elsewhere
  first (steps 3-5).

## 7. Restore verification checklist

After any restore (test or real), confirm all of the following before considering it successful:

- [ ] `mongorestore` exited 0 with no error in its output.
- [ ] Every expected collection exists in the restored database: `businesses`, `users`,
      `subscriptions`, `orders`, `payments`, `menuitems`, `categories` (extend this list for any
      collection meaningfully in use at the time of the incident).
- [ ] Document counts in the restored database are non-zero and in the right order of magnitude
      compared to the backup's own known size (not necessarily exact if the backup predates the
      incident by some hours).
- [ ] At least one real, representative document from each of Business/User/Subscription/Order/
      Payment/MenuItem opens correctly and has its expected fields (not truncated/corrupted).
- [ ] Critical indexes exist on the restored collections — at minimum `orders`'s
      `{restaurantId, orderNumber}` unique index and `payments`'s uniqueness guard (see
      `docs/database-indexes-and-migrations.md` for the full authoritative list) — compare
      `db.collection.getIndexes()` between source and restored target if in doubt.
- [ ] A real application process (not just a raw driver query) can connect to the restored
      database and read through its actual Mongoose models without error.
- [ ] The **original/production** database's own data and document counts are unchanged by this
      entire process (confirm this explicitly if the restore target was ever momentarily
      ambiguous).

## 8. Restore test evidence (this phase)

An actual, full backup → restore → verify cycle was run this phase — not merely documented:

- **Backed up**: the local development MongoDB (`restaurant_platform`), a real, populated instance
  with 1,741 `businesses`, 3,831 `users`, 323 `subscriptions`, 1,583 `orders`, 212 `payments`, 679
  `menuitems`, and 698 `categories` documents — accumulated real, representative data across this
  project's entire testing history, not a synthetic sample. `mongodump` produced 81 files, ~1.2MB
  gzipped, in seconds.
- **First restore attempt caught a real bug in the restore script itself**: an initial design that
  passed `mongorestore` a bare dump directory (relying on `--uri`'s own database path to select the
  target) silently restored back into the **source** database instead of the intended disposable
  one — because a directory-based `mongorestore` always uses the dump's own per-database
  subdirectory name, ignoring a different name in `--uri`. Confirmed harmless in this instance
  (identical data restored over itself, verified via before/after document counts on the original
  database — nothing was lost), but a real design flaw that would have silently overwritten
  *different* data in a genuine restore scenario. **Fixed**: the script now always uses
  `mongorestore --nsFrom/--nsTo` to explicitly rename onto a required `--target-db` argument,
  closing this exact class of mistake structurally rather than relying on operator care.
- **Second restore attempt, corrected**: restored the same backup into a disposable
  `restaurant_platform_restore_test` database on the same local MongoDB instance. Verified
  afterward:
  - All 7 collection counts in the restored database **exactly matched** the source
    (1,741/3,831/323/1,583/212/679/698).
  - The **original** database's counts were **unchanged**, confirming no cross-contamination.
  - `orders`'s indexes were identical between source and restored (`_id_`, `customerId_1`,
    `customerId_1_createdAt_-1`, `restaurantId_1_createdAt_-1`, `restaurantId_1_orderNumber_1`,
    `restaurantId_1_status_1_createdAt_-1`, `restaurantId_1_tableId_1_status_1`, `status_1`).
  - A real restaurant-owner `User` document and a real `Order` document (with correct
    `orderNumber`/`status`/`paymentStatus`) were both readable in the restored database.
  - **Application connectivity, via the real app code, not just raw queries**: pointed the actual
    `connectDB()` and real `Order`/`Business`/`User` Mongoose models at the restored database —
    `Order.countDocuments()` returned 1,583 (matching), `Order.countDocuments({paymentStatus:
    "paid"})` returned 161, `Business.countDocuments()` returned 1,741, and a sample paid order
    document had a correctly-typed `total`/`orderNumber`/`status`. This proves the restored
    database is genuinely usable by this application, not merely present in MongoDB.
- **Failure-path testing**: `backupDatabase.ts` against a deliberately unreachable Mongo target
  failed cleanly with a clear, redacted error (`mongodb://[redacted]`, never the real URI) and
  exit code 1. `restoreDatabase.ts` was confirmed to refuse to run with: no arguments at all;
  missing `--confirm`; and a target identical to the environment's own configured `MONGO_URI`
  without the explicit override flag — all four refusals produced clear, actionable error
  messages rather than silently doing something unexpected.
- **No production data was touched at any point.** The entire test used the local development
  database as source and a same-instance disposable database as target; the production Atlas
  cluster was never written to during this test (it was only ever read from, non-destructively, in
  the unrelated plan-catalog seed run performed earlier this session).
- All temporary verification scripts and the disposable test database/backup directory were
  deleted after the test — nothing from this test run was left in the repository or in either
  database.

## 9. Recovery objectives (targets, not guarantees)

- **RPO (Recovery Point Objective): up to 24 hours** — the daily backup schedule (§3) means, in the
  worst case, up to a full day of writes since the last backup could be lost in a total-loss
  scenario. If this is not acceptable, the real fix is increasing backup frequency (or, on a
  dedicated Atlas tier, enabling continuous/point-in-time Cloud Backup) — a **founder decision**
  balancing cost against acceptable data-loss window, not something this runbook should silently
  assume.
- **RTO (Recovery Time Objective): a few hours**, dominated by the time to identify the incident,
  retrieve the right backup, and run the restore procedure above (the restore operation itself
  took under 90 seconds against ~1.2MB of real test data in §8 — production time will scale with
  actual data volume, and should be re-measured against real production backup sizes once they
  exist).

These are working targets to plan around, not contractual guarantees to any customer.

## 10. Security

- Backup files are never committed to this repository (`backups/` is gitignored) and must never be
  emailed, pasted into chat, or stored anywhere outside the designated bucket (§5).
- Neither `backupDatabase.ts` nor `restoreDatabase.ts` ever logs a raw connection string — both
  redact any `mongodb://`/`mongodb+srv://` substring in every log line and every error message,
  including on failure (proven in §8's failure-path testing).
- Backup storage access must be restricted to the same trust level as production database
  credentials — a backup is a complete, restorable copy of production data, not a lesser artifact.
- Filesystem permissions on any host running these scripts should restrict the `backups/`
  directory to the same user/service account that already runs the API — no broader than that.
- **Backup encryption**: this repository does not implement its own encryption-at-rest for backup
  files. If the chosen storage provider (§5) supports server-side encryption (most S3-compatible
  providers do, as a bucket-level setting), enable it there rather than adding custom encryption
  code here — this is a provider configuration step, not something to fake in application code.

## 11. Operational checklist

- [ ] Confirm the actual Atlas tier for the production cluster, and whether Atlas's own Cloud
      Backup is already available (§1).
- [ ] Provision/confirm a backup storage bucket separate from the primary application's own
      upload bucket, or a clearly separated prefix within it (§5).
- [ ] Schedule `npm run backup -w apps/api` (daily, §3) plus the storage-upload step (§5) via
      whatever mechanism the actual production host uses (cron, a scheduled container/task, etc.)
      — this repository does not include or assume a specific one.
- [ ] Confirm `mongodump`/`mongorestore` are installed wherever the schedule above actually runs.
- [ ] Set the retention/cleanup policy (§4) on the backup bucket (many S3-compatible providers
      support this as a lifecycle rule, avoiding a custom cleanup script).
- [ ] Re-run the restore procedure (§6) against a real production backup at least once after the
      first production backups exist, to confirm this runbook's evidence (§8, currently based on
      local dev data) also holds against real production-shaped data and volume.
- [ ] Revisit the RPO/RTO targets (§9) with the founder once real production traffic/data volume
      is known.
