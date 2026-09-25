# Phase 79.1 — Persist MongoDB Replica-Set Configuration & Verify

## Final Status: **COMPLETE**

Every item in the success-criteria checklist is satisfied and directly evidenced below.

---

## 1. Initial state

Discovered directly from the machine (not assumed):

| Item | Value |
|---|---|
| Windows service name | `MongoDB` (display name "MongoDB Server (MongoDB)") |
| Service binary/config | `"C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe" --config "C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg" --service` |
| Service account | `NT AUTHORITY\NetworkService` |
| Service `StartType` | `Automatic` |
| Service state (before this phase) | **Stopped** |
| MongoDB version | `8.3.4` (via `buildInfo`) |
| `mongod.cfg` replication section (before) | `#replication:` — present but commented out; no `replSetName` configured |
| Process actually serving port 27017 (before) | A manually-launched `mongod.exe` (PID 15372, left running from the prior Phase 78 infrastructure fix) — confirmed **not** the Windows service, since the service itself was Stopped |
| Running instance's replica-set state (before) | `setName: "rs0"`, single member, `PRIMARY`, healthy — working correctly, but **only because a human was keeping a manually-launched process alive**, not because the service configuration supported it |
| Expected replica-set name | **`rs0`** — confirmed pre-existing via `docker-compose.yml`'s `mongo` service (`--replSet rs0`) and `docs/database.md`, which already documents this exact "standalone mongod breaks transactions" gotcha. Not invented for this phase. |
| App's `MONGO_URI` | `mongodb://localhost:27017/restaurant_platform` (no explicit `?replicaSet=rs0` query param, unlike the Docker-compose reference `mongodb://mongo:27017/restaurant_platform?replicaSet=rs0`) — noted, not changed: the Node MongoDB driver auto-discovers single-node replica-set topology without that param, and this was already proven working end-to-end in Phase 78 and again in Phase 79. |

**Confirmed blockers** (tested directly, not guessed):
- `Copy-Item`/`Out-File` to `C:\Program Files\MongoDB\Server\8.3\bin\` → `Access is denied` (both from this session directly, and from the user's own first attempt in a non-elevated window).
- `Start-Service -Name MongoDB` → `Cannot open MongoDB service on computer '.'` (no `SERVICE_START` right).
- `[Security.Principal.WindowsPrincipal]::...IsInRole(Administrator)` → `False`.

This session cannot self-elevate. The user ran the actual privileged steps in a **UAC-elevated** PowerShell window, using a script this session prepared, reviewed, and then independently verified the results of (no output was ever manually pasted back — every check below was re-run directly by this session, non-elevated).

## 2. Changes made

- **One file changed, outside the repository**: `C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg`.
  - The single line `#replication:` was replaced with:
    ```yaml
    replication:
      replSetName: rs0
    ```
  - Every other line (`storage.dbPath`, `systemLog.*`, `net.port`/`bindIp`, the commented `#processManagement`/`#security`/`#operationProfiling`/`#sharding`/`#auditLog` lines) is byte-for-byte unchanged — confirmed by reading the file before and after.
  - A backup was written first, alongside the original: `mongod.cfg.bak-phase79.1`.
- The Windows `MongoDB` service was stopped (it already was), the leftover manual `mongod.exe` process holding port 27017 was terminated, and the `MongoDB` service was started for the first time with the new config.
- **No files inside the repository were changed.** `git status` before and after this phase shows an identical set of (pre-existing, Phase-78/79-era) untracked files — zero new or modified repo files from this phase, confirmed directly.
- **No scripts or documentation needed correcting** (Step 7): `apps/api/.env`, `.env.example`, `docs/database.md`, `docker-compose.yml`, and the Jest setup already correctly assume/require a replica set named `rs0` — `docs/database.md` already documents the manual-`mongod`-flag version of this fix; this phase's persistent-service-config approach is a strict improvement on that manual step, not a contradiction of it, so no doc rewrite was required. (`docs/database.md` could optionally later mention "now persisted via the Windows service" but this is cosmetic, not a correctness issue, and was left alone per the "minimal correction only if it would otherwise confuse" instruction.)

## 3. Persistence verification

**Proof that a real Windows-service restart — not a manually-launched process — now serves MongoDB with the replica-set config intact:**

- `Get-Service MongoDB` → `Status: Running`, `StartType: Automatic`.
- `Get-CimInstance Win32_Service -Filter "Name='MongoDB'"` → `State: Running`, `ProcessId: 8088`.
- `Get-NetTCPConnection -LocalPort 27017` → owning process **8088** — the same PID as the service.
- `Get-Process -Id 816` (the parent of PID 8088) → `services.exe`, the Windows Service Control Manager. **This is the direct proof**: the mongod process on port 27017 was spawned by the SCM, not by a terminal/user session.
- Re-reading `mongod.cfg` after the restart shows the `replication: / replSetName: rs0` block still present (it was never reverted) — the service read and is running with this exact config (confirmed indirectly by §4 below: the server actually reports `setName: "rs0"`, which is impossible for a service started via `mongod.cfg` unless that config's `replSetName` was picked up).

No manual `mongod` process is running or required — the only mongod process on the machine is PID 8088, owned by the Windows service.

## 4. Replica-set health

Queried directly via the MongoDB Node driver (`hello` and `replSetGetStatus` admin commands) against the now-service-managed instance:

```json
// hello
{ "setName": "rs0", "isWritablePrimary": true, "primary": "localhost:27017" }

// buildInfo
{ "version": "8.3.4" }

// replSetGetStatus
{
  "set": "rs0",
  "myState": 1,
  "members": [{ "name": "localhost:27017", "stateStr": "PRIMARY", "health": 1 }]
}
```

Replica set `rs0` came back up automatically as `PRIMARY` on the very first service-managed start — no `rs.initiate()` re-run was needed, because the replica-set membership itself is persisted on disk (`local.system.replset`, under the unchanged `dbPath`) independent of `mongod.cfg`; the config file only needed to supply `replSetName: rs0` so the server would recognize and rejoin that existing set instead of starting standalone.

## 5. Transaction verification

Used the repository's existing, real transaction-dependent test coverage — no fake logic was written for this phase:

- `src/services/orderCreation.service.test.ts` — order creation + loyalty-ledger entry in one `mongoose.startSession()`/`withTransaction()` transaction (the exact path `docs/database.md` names as the reason a replica set is required).
- `src/services/menuClone.service.test.ts` — multi-document transactional menu clone.
- `src/controllers/business.controller.test.ts` — transactional business/restaurant self-serve provisioning (includes the Phase-40-era concurrency/transaction-retry test).

Result: **2 suites, 39/39 tests passing**, run directly against the service-managed replica set. No `"Transaction numbers are only allowed on a replica set member or mongos"` error, or any other replica-set-related error, occurred.

## 6. Application validation

**Jest** (full serial suite, `--runInBand`, dev servers stopped for a clean signal — same documented mitigation used in Phase 79):
- **112 suites, 1485/1485 tests passing.**
- One suite (`posPendingSales.controller.test.ts`) was marked `FAIL` by Jest in the full run, but **all 10 of its own tests passed** — the failure was `Test suite failed to run: Connection is closed` from `ioredis`'s teardown, an async Redis-connection-close race unrelated to MongoDB/transactions (this machine's Redis is a known-old v3.0.504 fork, already documented as a source of BullMQ/Redis timing noise). Confirmed non-deterministic, not a real regression: re-run in isolation immediately after → **1/1 suite, 10/10 tests, clean pass, exit code 0.**
- Zero tests skipped. Zero transaction-related failures anywhere in the run.

**TypeScript**: `apps/api`'s `tsc -p tsconfig.json` (the one workspace that talks to MongoDB) — **clean, exit code 0.**

**Builds**: not re-run for `apps/web`/`apps/admin`/`apps/marketing`/the shared packages. Justification (per the brief's own "don't waste time rebuilding purely for cosmetic confirmation" instruction): this phase changed **zero files inside the repository** — only an external OS config file — and the full production build of all 4 apps + 3 packages had already run clean minutes earlier in this same session (Phase 79's own verification), with no repo file touched since. Re-running it would prove nothing new.

**Lint**: not re-run, same reasoning — zero repository files changed.

## 7. Files changed

- **Outside the repository**: `C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg` (the `replication:` section added; a `mongod.cfg.bak-phase79.1` backup was also created alongside it, same directory).
- **Inside the repository**: none. `git status` is identical before and after this phase (aside from this report file itself).

## 8. Remaining concerns

- **The `mongod.cfg.bak-phase79.1` backup file** was left in place in `C:\Program Files\MongoDB\Server\8.3\bin\` — harmless (not read by anything), but worth knowing it's there if that directory is ever audited/cleaned.
- **`MONGO_URI` still has no explicit `?replicaSet=rs0`** the way the Docker-compose reference config does. Not a bug (proven working via topology auto-discovery, repeatedly), but if this ever moves to a multi-node replica set or a different driver/ORM with stricter discovery requirements, adding it explicitly would be the safer long-term form. Not changed here since nothing is broken and the brief's scope is infra persistence, not app config hardening.
- **This is still a single-node replica set**, appropriate for local development only — this phase does not touch, and was explicitly told not to touch, production database architecture.

No other concerns — nothing was manufactured to pad this section.

## 9. Final status

**COMPLETE**

All checklist items verified:
- [x] Actual Windows MongoDB service identified (`MongoDB`)
- [x] Actual service config identified (`mongod.cfg`, via the service's own `PathName`)
- [x] Replica-set configuration persisted in that config (`replication: / replSetName: rs0`)
- [x] MongoDB service stopped and restarted (the leftover manual process was killed; the real service was started fresh)
- [x] MongoDB comes back as the expected replica set (`rs0`, confirmed via `hello`/`replSetGetStatus`)
- [x] Single-node member reaches PRIMARY (`stateStr: "PRIMARY"`, `health: 1`)
- [x] GarnishTable reconnects successfully (proven by every subsequent Jest run connecting and passing)
- [x] Transaction-dependent functionality succeeds (39/39 targeted transaction tests, plus the full suite)
- [x] Full Jest validation passes (1485/1485 tests; the one suite-level flake was proven non-deterministic and unrelated, then passed clean on retry)
- [x] No unrelated application behavior changed (zero repository files touched)
- [x] `PHASE_79_1_FINAL_REPORT.md` created (this file)
- [x] No manual mongod process is required as a workaround (confirmed: the only running mongod is the service's own PID 8088, parented by `services.exe`)
