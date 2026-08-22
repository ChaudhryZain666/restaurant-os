import { z } from "zod";
import { booleanQueryParam, paginationQueryShape, sortableQueryShape } from "./pagination.js";

/** "pending" is never set here — a restaurant only reaches "pending" at creation time, which is
 *  not a platform-admin action. Suspending/reactivating toggles between these two. */
export const updateRestaurantStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});
export type UpdateRestaurantStatusInput = z.infer<typeof updateRestaurantStatusSchema>;

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const listPlatformRestaurantsQuerySchema = z.object({
  ...paginationQueryShape,
  ...sortableQueryShape(["createdAt", "name", "status"], "createdAt"),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["pending", "active", "suspended"]).optional(),
});
export type ListPlatformRestaurantsQueryInput = z.infer<typeof listPlatformRestaurantsQuerySchema>;

export const listPlatformUsersQuerySchema = z.object({
  ...paginationQueryShape,
  ...sortableQueryShape(["createdAt", "name", "email", "role"], "createdAt"),
  search: z.string().trim().max(100).optional(),
  role: z
    .enum(["platform_admin", "restaurant_owner", "restaurant_manager", "restaurant_staff", "kitchen_staff", "customer"])
    .optional(),
  isActive: booleanQueryParam(),
});
export type ListPlatformUsersQueryInput = z.infer<typeof listPlatformUsersQuerySchema>;
