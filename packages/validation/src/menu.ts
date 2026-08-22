import { z } from "zod";

export const menuItemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  price: z.number().nonnegative(),
  // Accepts an absolute URL OR a same-origin relative path (e.g. "/menu-images/foo.svg") — the
  // storefront has no external image hosting, so self-hosted local assets are the supported
  // path, and a bare `.url()` check would reject those even though `<img src>` renders them fine.
  imageUrl: z.string().min(1).max(500).optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});
export type MenuItemInput = z.infer<typeof menuItemSchema>;

// Deliberately has no `restaurantId` field (menuItemSchema doesn't declare one either) — zod's
// default "strip" mode discards any unrecognized key, so this schema doubles as the field
// allowlist for PATCH: a client-supplied restaurantId (or any other unknown field) never survives
// validation, regardless of what the request body contains. categoryId IS allowed to change here
// (moving an item to a different category of the *same* restaurant is legitimate) — the controller
// is responsible for verifying any new categoryId still belongs to the caller's own restaurant.
export const updateMenuItemSchema = menuItemSchema.partial();
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
