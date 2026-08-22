import type { HydratedDocument } from "mongoose";
import type { RestaurantReadiness, RestaurantReadinessCheck } from "@restaurant/types";
import type { RestaurantDoc } from "../models/Restaurant.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";

/**
 * The single source of truth for "is this restaurant allowed to publish" — read by both the
 * owner-facing readiness endpoint (GET .../readiness, purely informational) and the publish
 * endpoint itself (which re-checks server-side rather than trusting whatever the client last
 * fetched, per Phase 14's server-must-enforce-not-just-hide-the-button requirement). Deliberately
 * small: only what's actually required for a customer to be able to complete an order, not every
 * setting a restaurant could theoretically configure. Payment-provider configuration is
 * intentionally NOT a check here — cash-only launch is a supported path (Phase 13/14 scope rules).
 */
export async function computeReadiness(restaurant: HydratedDocument<RestaurantDoc>): Promise<RestaurantReadiness> {
  const [categoryCount, itemCount] = await Promise.all([
    Category.countDocuments({ restaurantId: restaurant._id, isActive: true }),
    MenuItem.countDocuments({ restaurantId: restaurant._id, isAvailable: true }),
  ]);

  const { settings } = restaurant;
  const hasOrderType = Boolean(settings.pickupEnabled || settings.deliveryEnabled || settings.dineInEnabled);
  // Only required when delivery is actually offered — a pickup/dine-in-only restaurant has no
  // need for coordinates (see restaurantAvailability.service.ts's own settings-only availability
  // logic, which has the same "don't require what isn't used" shape).
  const hasRequiredLocation = !settings.deliveryEnabled || (restaurant.latitude != null && restaurant.longitude != null);

  const checks: RestaurantReadinessCheck[] = [
    { key: "profile", label: "Restaurant name is set", complete: Boolean(restaurant.name?.trim()) },
    {
      key: "menu",
      label: "At least one active category with an available menu item",
      complete: categoryCount > 0 && itemCount > 0,
    },
    {
      key: "orderType",
      label: "At least one ordering method is enabled (pickup, delivery, or dine-in)",
      complete: hasOrderType,
    },
    {
      key: "location",
      label: "Restaurant location is set (required because delivery is enabled)",
      complete: hasRequiredLocation,
    },
  ];

  return { ready: checks.every((c) => c.complete), checks };
}
