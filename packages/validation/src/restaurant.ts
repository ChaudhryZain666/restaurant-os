import { z } from "zod";
import { WEEKDAYS } from "@restaurant/types";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Phase 14: replaces the old ownerId-referencing-an-existing-user shape, which had no UI-reachable
// way to ever get that user created first (see docs — the provisioning chicken-and-egg gap). The
// owner is now provisioned atomically alongside the restaurant, via the same invite-token pattern
// staff invites already use (see restaurant.controller.ts's createRestaurant).
export const createRestaurantSchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
    timezone: z.string().min(1).optional(),
    currency: z.string().length(3).optional(),
    // Phase 18 — omitted (the default): `owner` is required, and a new Business is created
    // alongside this Restaurant, same as before this field existed. Provided: this Restaurant
    // becomes a second location under an existing Business instead — no new owner is
    // created/invited (the existing business's owner already covers every location under it), so
    // `owner` must be omitted rather than silently ignored.
    businessId: z.string().min(1).optional(),
    owner: z
      .object({
        name: z.string().min(2).max(80),
        email: z.string().email(),
      })
      .optional(),
  })
  .refine((v) => (v.businessId ? !v.owner : Boolean(v.owner)), {
    message: "Provide either `owner` (to create a new business) or `businessId` (to add a location to an existing one), not both",
    path: ["owner"],
  });
export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

// Phase 19 — the owner-facing counterpart to createRestaurantSchema's businessId branch: always
// attaches to the caller's OWN business (taken from the URL's :businessId, verified server-side by
// requireBusinessMatch — never from this body), so there's no owner/businessId choice to make here
// the way the platform-admin route has. cloneFromLocationId is optional: a one-time copy of
// another of the business's own locations' menu (Category/MenuItem/ModifierGroup) into the new
// location, fully independent afterward — see business.controller.ts's createLocationForBusiness.
// The controller independently re-verifies cloneFromLocationId actually belongs to the same
// business before touching it — never trusted from this body alone.
export const createLocationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  timezone: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
  cloneFromLocationId: z.string().min(1).optional(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

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
  deliveryFeeTiers: z
    .array(z.object({ maxDistanceKm: z.number().positive(), fee: z.number().nonnegative() }))
    .optional(),
  businessHours: z.array(businessHoursDaySchema).optional(),
  temporarilyPaused: z.boolean().optional(),
  pausedReason: z.string().max(200).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #C2410C")
    .optional(),
  // Phase 28 — feature toggles, same "hide the nav/route, never delete the data" contract as
  // dineInEnabled above.
  kitchenEnabled: z.boolean().optional(),
  staffEnabled: z.boolean().optional(),
  // POS phase — same contract as kitchenEnabled/staffEnabled above.
  posEnabled: z.boolean().optional(),
  // Delivery-integrations phase — which courier dispatches a delivery order.
  deliveryProvider: z.enum(["manual", "uber_direct"]).optional(),
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
