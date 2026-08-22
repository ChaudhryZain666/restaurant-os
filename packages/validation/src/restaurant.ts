import { z } from "zod";
import { WEEKDAYS } from "@restaurant/types";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Phase 14: replaces the old ownerId-referencing-an-existing-user shape, which had no UI-reachable
// way to ever get that user created first (see docs — the provisioning chicken-and-egg gap). The
// owner is now provisioned atomically alongside the restaurant, via the same invite-token pattern
// staff invites already use (see restaurant.controller.ts's createRestaurant).
export const createRestaurantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  timezone: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
  owner: z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
  }),
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
  // Default false, unlike pickup — a restaurant must deliberately opt into QR/dine-in ordering
  // (and, realistically, set up at least one table) rather than having it silently available.
  dineInEnabled: z.boolean().optional(),
  // At least one must remain true — enforced in restaurant.controller.ts's updateRestaurant
  // after merging with the restaurant's existing settings (a partial PATCH body alone can't tell
  // whether disabling one here would leave the other already-false, so it can't be a zod-level
  // cross-field check).
  cashEnabled: z.boolean().optional(),
  onlinePaymentEnabled: z.boolean().optional(),
  minOrderAmount: z.number().nonnegative().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  deliveryFee: z.number().nonnegative().optional(),
  // Straight-line radius from the restaurant's own coordinates — see
  // docs/delivery-architecture.md. Capped at 100km as a sanity bound, not a real product limit.
  deliveryRadiusKm: z.number().positive().max(100).optional(),
  businessHours: z.array(businessHoursDaySchema).optional(),
  temporarilyPaused: z.boolean().optional(),
  pausedReason: z.string().max(200).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #C2410C")
    .optional(),
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
  // Manually entered by the owner today — no geocoding provider is wired up (see
  // services/geocoding.service.ts). null clears a previously-set coordinate.
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  settings: restaurantSettingsSchema.optional(),
});
export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;
