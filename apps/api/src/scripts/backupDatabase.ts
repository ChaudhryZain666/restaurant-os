import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

/**
 * Phase 77 — the one real, tested production backup mechanism this repo has (see
 * docs/backup-and-recovery.md for the full runbook this backs). Deliberately a thin wrapper around
 * the real `mongodump` binary rather than a hand-rolled export: `mongodump` produces a consistent,
 * restorable BSON dump (including indexes) using the exact same driver/wire-protocol MongoDB
 * itself ships for this purpose — reinventing that would be the "elaborate backup platform" this
 * phase's brief explicitly says not to build.
 *
 * Reuses the app's own MONGO_URI (env.ts) rather than a second, duplicated connection setting —
 * this only ever READS from that URI (mongodump is non-destructive to its source), so pointing it
 * at production is the correct and intended use, unlike restoreDatabase.ts's target URI, which is
 * never taken from env for exactly the opposite reason (see that script's own header comment).
 */
const OUTPUT_ROOT = resolve(process.cwd(), "backups");

/** Never let a raw child_process error (which can echo the full command line, URI included) reach
 *  a log line — mongodump's argv contains the real connection string with its password. */
function redact(message: string): string {
  return message.replace(/mongodb(\+srv)?:\/\/[^\s"]+/g, "mongodb$1://[redacted]");
}

async function run(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(OUTPUT_ROOT, timestamp);
  mkdirSync(outDir, { recursive: true });

  logger.info("[backup] starting mongodump", { outDir, database: "restaurant_platform" });

  await new Promise<void>((resolvePromise, reject) => {
    execFile(
      "mongodump",
      ["--uri", env.MONGO_URI, "--out", outDir, "--gzip"],
      { maxBuffer: 1024 * 1024 * 32 },
      (err, _stdout, stderr) => {
        if (err) {
          // Never log stdout/stderr raw — mongodump echoes its own --uri argument back on some
          // failure paths (e.g. a malformed URI), which would otherwise leak the credential into
          // whatever captures this process's logs.
          reject(new Error(redact(stderr || err.message)));
          return;
        }
        resolvePromise();
      }
    );
  });

  // mongodump writes one directory per database under outDir — report what actually landed rather
  // than assuming a name, so this script stays correct if the target database is ever renamed.
  const dbDirs = readdirSync(outDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  let totalBytes = 0;
  let fileCount = 0;
  for (const dbDir of dbDirs) {
    const dbPath = resolve(outDir, dbDir.name);
    for (const file of readdirSync(dbPath)) {
      totalBytes += statSync(resolve(dbPath, file)).size;
      fileCount += 1;
    }
  }

  logger.info("[backup] mongodump completed", {
    outDir,
    databases: dbDirs.map((d) => d.name),
    fileCount,
    totalMB: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
  });
  console.log(`[backup] done: ${outDir} (${dbDirs.map((d) => d.name).join(", ")}, ${fileCount} files)`);
}

if (!existsSync(OUTPUT_ROOT)) mkdirSync(OUTPUT_ROOT, { recursive: true });

run().catch((err) => {
  logger.error("[backup] failed", { error: (err as Error).message });
  console.error(`[backup] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
