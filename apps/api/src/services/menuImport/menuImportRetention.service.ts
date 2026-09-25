import { MenuImportJob } from "../../models/MenuImportJob.js";
import { getStorageService } from "../../storage/index.js";
import { logger } from "../../common/logger.js";

/**
 * Phase 81 — deletes a job's raw uploaded source bytes once its retention window has passed,
 * satisfying "do not store unnecessary raw source data indefinitely." The MenuImportJob document
 * itself (draftRows, confidence, published report) is kept indefinitely, same as AuditLog — only
 * the source files are perishable. Never deletes the job document, never touches jobs whose
 * retention window hasn't passed yet. A single storage delete failure is logged and leaves that
 * job's sourceFilesDeletedAt unset, so the next day's tick retries it automatically — same
 * "observe/retry, don't crash the sweep" discipline as this codebase's other background sweeps.
 */
export async function runMenuImportRetentionSweep(): Promise<void> {
  const now = new Date();
  // Includes url-sourced jobs (sourceFiles: []) even though there's nothing to delete for them —
  // sourceFilesDeletedAt still gets set so they don't linger in this query forever; a URL job's
  // own sourceUrl field is a small reference, not raw uploaded content, and is kept regardless.
  const due = await MenuImportJob.find({
    sourceRetentionDeleteAt: { $lte: now },
    sourceFilesDeletedAt: { $exists: false },
  }).select("_id sourceFiles");

  if (due.length === 0) return;

  const storage = getStorageService();
  for (const job of due) {
    try {
      for (const file of job.sourceFiles) {
        await storage.delete(file.storageKey);
      }
      await MenuImportJob.updateOne({ _id: job._id }, { $set: { sourceFilesDeletedAt: new Date() } });
    } catch (err) {
      logger.error("menu import retention sweep failed to delete source files", { jobId: job.id, error: (err as Error).message });
    }
  }
}
