import type { MenuImportColumnMapping, MenuImportReport } from "@restaurant/types";
import { ApiError } from "../../utils/ApiError.js";
import { normalizeRows } from "./normalizeRows.js";
import { resolveImport, type ImportScope } from "./resolveImport.js";
import { suggestColumnMapping, missingRequiredFields } from "./columnMapping.js";
import { parseUploadedSheet, type MenuImportFileKind } from "./buildPreview.js";
import { writeResolvedImport } from "./writeResolvedImport.js";

interface CommitParams {
  fileName: string;
  buffer: Buffer;
  kind: MenuImportFileKind;
  requestedMapping: MenuImportColumnMapping;
  scope: ImportScope;
  duplicateStrategy: "skip" | "update";
  actorUserId: string;
  actorRole: string;
}

/**
 * Phase 30 — the single server-authoritative write path. Deliberately re-runs the ENTIRE
 * parse/normalize/resolve pipeline fresh (never trusts a client-echoed preview result — see
 * docs/menu-import-architecture.md's "why the file is re-uploaded on commit" section) so nothing
 * about what actually gets written to the database ever passed through client hands unverified.
 *
 * Phase 81 — the actual transactional write moved to writeResolvedImport.ts (shared with the new
 * async import-job publish flow); this function is now parse -> normalize -> resolve -> delegate,
 * behaviorally identical to before (verified by this file's own existing test suite passing
 * unchanged post-refactor).
 */
export async function commitImport(params: CommitParams): Promise<MenuImportReport> {
  const sheet = await parseUploadedSheet(params.buffer, params.kind);
  const suggestedMapping = suggestColumnMapping(sheet.headers);
  const appliedMapping: MenuImportColumnMapping = { ...suggestedMapping };
  for (const header of sheet.headers) {
    if (header in params.requestedMapping) appliedMapping[header] = params.requestedMapping[header];
  }
  const unmapped = missingRequiredFields(appliedMapping);
  if (unmapped.length > 0) {
    throw ApiError.badRequest(`This mapping is missing required fields: ${unmapped.join(", ")}.`);
  }

  const normalized = normalizeRows(sheet, appliedMapping);
  const resolved = await resolveImport(normalized, params.scope, params.duplicateStrategy);

  return writeResolvedImport({
    resolved,
    scope: params.scope,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    fileName: params.fileName,
  });
}
