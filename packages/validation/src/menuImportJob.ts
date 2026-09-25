import { z } from "zod";
import { MENU_IMPORT_USER_ACTIONS } from "@restaurant/types";

/** Body for POST .../menu/import-jobs when sourceType is "url" (pdf/image/images jobs send the
 *  source as multipart file(s) instead, parsed by multer, not this schema — see
 *  menuImportJob.controller.ts). */
export const createUrlMenuImportJobSchema = z.object({
  url: z.string().url().max(2048),
});
export type CreateUrlMenuImportJobInput = z.infer<typeof createUrlMenuImportJobSchema>;

const menuImportDraftRowModifierOptionSchema = z.object({
  name: z.string().min(1).max(80),
  priceAdjustment: z.number().nonnegative(),
});
const menuImportDraftRowModifierGroupSchema = z.object({
  name: z.string().min(1).max(80),
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().positive(),
  options: z.array(menuImportDraftRowModifierOptionSchema).min(1),
});

/** PATCH .../menu/import-jobs/:jobId/rows/:rowNumber — every field optional (a reviewer edits one
 *  or two fields at a time), each still bound by the same limits the manual menu editor enforces
 *  (menu.ts's menuItemSchema) so a draft-row edit can never smuggle in oversized data that skipped
 *  the normal parse-time bounds. */
export const updateMenuImportDraftRowSchema = z.object({
  categoryName: z.string().trim().min(1).max(80).optional(),
  itemName: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  price: z.number().nonnegative().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  imageUrl: z.string().min(1).max(500).optional(),
  modifierGroups: z.array(menuImportDraftRowModifierGroupSchema).optional(),
  userAction: z.enum(MENU_IMPORT_USER_ACTIONS).optional(),
});
export type UpdateMenuImportDraftRowInput = z.infer<typeof updateMenuImportDraftRowSchema>;

/** POST .../menu/import-jobs/:jobId/publish — the job-wide fallback applied only to rows the
 *  reviewer never explicitly set userAction on, mirroring CSV commit's own duplicateStrategy
 *  default exactly ("skip" — never silently overwrite existing data unless asked). */
export const publishMenuImportJobSchema = z.object({
  defaultDuplicateStrategy: z.enum(["skip", "update", "merge"]).default("skip"),
});
export type PublishMenuImportJobInput = z.infer<typeof publishMenuImportJobSchema>;
