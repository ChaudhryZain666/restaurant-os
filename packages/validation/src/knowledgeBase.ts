import { z } from "zod";
import { ARTICLE_STATUSES } from "@restaurant/types";

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const kbCategorySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(slugPattern, "must be lowercase letters, numbers, and hyphens"),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().optional(),
});
export type KbCategoryInput = z.infer<typeof kbCategorySchema>;

export const updateKbCategorySchema = kbCategorySchema.partial();
export type UpdateKbCategoryInput = z.infer<typeof updateKbCategorySchema>;

export const kbArticleSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(slugPattern, "must be lowercase letters, numbers, and hyphens"),
  summary: z.string().min(1).max(300),
  content: z.string().min(1),
  status: z.enum(ARTICLE_STATUSES).default("draft"),
  sortOrder: z.number().int().nonnegative().default(0),
});
export type KbArticleInput = z.infer<typeof kbArticleSchema>;

export const updateKbArticleSchema = kbArticleSchema.partial();
export type UpdateKbArticleInput = z.infer<typeof updateKbArticleSchema>;
