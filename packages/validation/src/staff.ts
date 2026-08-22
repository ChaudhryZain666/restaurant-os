import { z } from "zod";

/** Roles an owner can assign to a staff account. Never "restaurant_owner" (there's exactly one
 * per restaurant) and never "platform_admin"/"customer" (not restaurant-scoped staff roles). */
export const STAFF_ROLES = ["restaurant_manager", "restaurant_staff", "kitchen_staff"] as const;

export const inviteStaffSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  role: z.enum(STAFF_ROLES),
  phone: z.string().min(7).max(20).optional(),
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const updateStaffSchema = z
  .object({
    role: z.enum(STAFF_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: "Provide at least one of role or isActive",
  });
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
