import { z } from "zod";

export const createTableSchema = z.object({
  name: z.string().min(1).max(50),
  capacity: z.number().int().positive().max(100).default(2),
  section: z.string().max(50).optional(),
});
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const updateTableSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  capacity: z.number().int().positive().max(100).optional(),
  section: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
