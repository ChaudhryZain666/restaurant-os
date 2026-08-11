import { z } from "zod";
import { WEEKDAYS } from "@restaurant/types";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const createRestaurantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  ownerId: z.string().min(1),
});
export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

export const businessHoursDaySchema = z
  .object({
    day: z.enum(WEEKDAYS),
    isClosed: z.boolean().default(false),
    open: z.string().regex(timePattern, "Use 24h HH:mm").optional(),
    close: z.string().regex(timePattern, "Use 24h HH:mm").optional(),
  })
  .refine((v) => v.isClosed || (v.open && v.close), {
    message: "open and close are required unless isClosed is true",
  });

export const restaurantSettingsSchema = z.object({
  currency: z.string().length(3).optional(),
  timezone: z.string().min(1).optional(),
  orderingEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
  minOrderAmount: z.number().nonnegative().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  deliveryFee: z.number().nonnegative().optional(),
  businessHours: z.array(businessHoursDaySchema).optional(),
  temporarilyPaused: z.boolean().optional(),
  pausedReason: z.string().max(200).optional(),
});
export type RestaurantSettingsInput = z.infer<typeof restaurantSettingsSchema>;

// Deliberately excludes slug, ownerId, and status — slug changes break storefront URLs,
// ownership/status changes are not self-service in Phase 1. Anything not listed here is
// stripped by zod, so it can never reach the update document (see menu.ts's updateMenuItemSchema
// for the same pattern, applied there against the Phase 0 audit's tenant-reassignment finding).
export const updateRestaurantSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  logo: z.string().url().optional(),
  coverImage: z.string().url().optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  settings: restaurantSettingsSchema.optional(),
});
export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;
