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
    // Phase 18 — which of the business's locations (Restaurant ids) this staff member can act on.
    // Not yet surfaced in any admin UI; PATCHable at the API level so the capability exists ahead
    // of a future multi-select control, laying groundwork without building that UI this phase.
    locationIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined || v.locationIds !== undefined, {
    message: "Provide at least one of role, isActive, or locationIds",
  });
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
