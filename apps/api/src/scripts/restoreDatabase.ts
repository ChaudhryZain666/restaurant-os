import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

/**
 * Phase 77 — the restore half of docs/backup-and-recovery.md. Deliberately NEVER reads
 * env.MONGO_URI as its target — that's the one thing that would make an accidental "I ran the
 * restore script and it quietly restored over the database this app is actually configured to
 * use" possible. The target is instead a REQUIRED, explicit `--target-uri` CLI argument the
 * operator must type out themselves, plus a REQUIRED `--confirm` flag — both must be present or
 * this refuses to run at all. If the explicit target happens to equal env.MONGO_URI (the
 * strongest possible signal this is about to overwrite the very database the app is live against),
 * a second, separately-named flag is required on top of `--confirm` — seeing that flag typed out
 * is the last, deliberate chance to stop before a real restore-over-production.
 *
 * Uses `mongorestore --nsFrom/--nsTo` (not a bare directory restore) to remap the dump's own
 * database name onto whatever database `--target-uri` actually points at: a bare `mongorestore
 * <dir>` restores each dump subdirectory into a database of THE SAME NAME on the target server,
 * completely ignoring any different database name in `--uri`'s own path — confirmed the hard way
 * during this phase's own restore test, where an attempted restore into a disposable
 * "..._restore_test" database silently landed back in the source database instead (same server,
 * identical data, so nothing was actually lost — but a real restore of OLDER data the same way
 * would have silently overwritten current production data). --nsFrom/--nsTo is the mechanism that
 * actually renames the target database during restore, and this script uses it unconditionally so
 * that mistake structurally can't repeat itself.
 *
 * Usage: tsx src/scripts/restoreDatabase.ts --from=<backup dir from backupDatabase.ts> \
 *   --target-uri="mongodb://host/" --target-db=<name> --confirm \
 *   [--i-understand-this-overwrites-the-configured-database]
 */
function redact(message: string): string {
  return message.replace(/mongodb(\+srv)?:\/\/[^\s"]+/g, "mongodb$1://[redacted]");
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    out[key] = rest.length ? rest.join("=") : true;
  }
  return out;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const from = typeof args.from === "string" ? resolve(args.from) : null;
  const targetUri = typeof args["target-uri"] === "string" ? (args["target-uri"] as string) : null;
  const targetDb = typeof args["target-db"] === "string" ? (args["target-db"] as string) : null;
  const confirmed = args.confirm === true;
  const overrideAcknowledged = args["i-understand-this-overwrites-the-configured-database"] === true;

  if (!from || !existsSync(from)) {
    throw new Error("Missing or invalid --from=<backup directory>. See docs/backup-and-recovery.md.");
  }
  if (!targetUri) {
    throw new Error(
      "Missing --target-uri. This script never defaults to the app's configured MONGO_URI — you must " +
        "type the real target out explicitly. See docs/backup-and-recovery.md before running this."
    );
  }
  if (!targetDb) {
    throw new Error(
      "Missing --target-db=<database name>. The restore always renames onto this explicit name via " +
        "mongorestore's --nsFrom/--nsTo — it never infers a target database name from the backup directory " +
        "or from --target-uri's own path. Pass the SAME name as the source to restore in place on a fresh " +
        "server, or a different name for a disposable test restore."
    );
  }
  if (!confirmed) {
    throw new Error("Missing --confirm. Re-read docs/backup-and-recovery.md's restore checklist, then re-run with --confirm.");
  }

  const dbDirs = readdirSync(from, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (dbDirs.length !== 1) {
    throw new Error(
      `Expected exactly one database directory under ${from} (backupDatabase.ts always dumps a single, ` +
        `URI-scoped database), found ${dbDirs.length}: ${dbDirs.map((d) => d.name).join(", ") || "(none)"}.`
    );
  }
  const sourceDb = dbDirs[0].name;

  const targetLooksLikeConfigured = targetUri === env.MONGO_URI && targetDb === sourceDb;
  if (targetLooksLikeConfigured && !overrideAcknowledged) {
    throw new Error(
      "--target-uri and --target-db together are IDENTICAL to this environment's own configured MONGO_URI " +
        "— you are about to restore over the database this application is currently live against. If that is " +
        "genuinely what you intend (a real disaster-recovery restore-over-production, not a test restore into " +
        "a disposable database), re-run with --i-understand-this-overwrites-the-configured-database added."
    );
  }

  logger.info("[restore] starting mongorestore", { from, sourceDb, targetDb });

  await new Promise<void>((resolvePromise, reject) => {
    execFile(
      "mongorestore",
      ["--uri", targetUri, "--gzip", "--drop", "--nsFrom", `${sourceDb}.*`, "--nsTo", `${targetDb}.*`, from],
      { maxBuffer: 1024 * 1024 * 32 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(redact(stderr || err.message)));
          return;
        }
        resolvePromise();
      }
    );
  });

  logger.info("[restore] mongorestore completed", { sourceDb, targetDb });
  console.log(`[restore] done: restored ${sourceDb} -> ${targetDb} from ${from}`);
}

run().catch((err) => {
  logger.error("[restore] failed", { error: (err as Error).message });
  console.error(`[restore] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
