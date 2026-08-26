import { z } from "zod";
import { MENU_IMPORT_FIELD_KEYS } from "@restaurant/types";

/**
 * Phase 30 — column mapping arrives as a JSON-encoded multipart field (multer parses the file
 * separately from the body, see menuImport.controller.ts), so this is applied via a manual
 * `.parse()` call inside the controller after multer runs, not the usual `validateBody` router
 * middleware (which assumes req.body is already a plain object by the time it runs).
 */
export const menuImportColumnMappingSchema = z.record(z.string(), z.enum(MENU_IMPORT_FIELD_KEYS).nullable());
export type MenuImportColumnMappingInput = z.infer<typeof menuImportColumnMappingSchema>;

export const menuImportPreviewRequestSchema = z.object({
  mapping: menuImportColumnMappingSchema.optional(),
});
export type MenuImportPreviewRequestInput = z.infer<typeof menuImportPreviewRequestSchema>;

export const menuImportCommitRequestSchema = z.object({
  mapping: menuImportColumnMappingSchema,
  duplicateStrategy: z.enum(["skip", "update"]).default("skip"),
});
export type MenuImportCommitRequestInput = z.infer<typeof menuImportCommitRequestSchema>;
