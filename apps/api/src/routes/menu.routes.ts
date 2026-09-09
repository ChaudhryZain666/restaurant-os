import { Router } from "express";
import { menuItemOverrideSchema, menuItemSchema, updateMenuItemSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
// Phase 59 — was requirePermission from middleware/rbac.js (plain, non-agency-aware) on every route
// below except /import/*. That contradicted this router's own documented intent
// (docs/multi-tenant-storefront-architecture.md's Phase 26 section: "menu.routes.ts... became
// agency-aware automatically... no change needed") and AGENCY_ROLE_GRANTS already listing
// restaurant.menu.read/write for agency roles — a real gap where an agency member could never
// actually reach Menu CRUD, only the later-added /import/* routes. Now consistent with
// table.routes.ts/staff.routes.ts's exact same alias convention.
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createMenuItem,
  deleteMenuItem,
  deleteMenuItemOverride,
  listAllMenuItems,
  listLocationOverrides,
  listMenu,
  putMenuItemOverride,
  updateMenuItem,
} from "../controllers/menu.controller.js";
import { commitMenuImport, getMenuImportReport, previewMenuImport } from "../controllers/menuImport.controller.js";

/** Mounted at /restaurants/:restaurantId/menu — mergeParams is required to see :restaurantId. */
export const menuRouter = Router({ mergeParams: true });

menuRouter.get("/", asyncHandler(listMenu));
menuRouter.get(
  "/items",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.read"),
  asyncHandler(listAllMenuItems)
);
// Phase 21 — every override row this location currently has, across categories/items/modifier
// groups. Same read permission as listAllMenuItems (staff already sees hidden items).
menuRouter.get(
  "/overrides",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.read"),
  asyncHandler(listLocationOverrides)
);
menuRouter.post(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  validateBody(menuItemSchema),
  asyncHandler(createMenuItem)
);
menuRouter.patch(
  "/:id",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  validateBody(updateMenuItemSchema),
  asyncHandler(updateMenuItem)
);
menuRouter.delete(
  "/:id",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(deleteMenuItem)
);
// Phase 21 — per-location override on a canonical item (price/availability/sortOrder).
menuRouter.put(
  "/:id/override",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  validateBody(menuItemOverrideSchema),
  asyncHandler(putMenuItemOverride)
);
menuRouter.delete(
  "/:id/override",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(deleteMenuItemOverride)
);

// Phase 30 — menu importer. Agency-aware via the same requirePermission alias as the rest of this
// router (Phase 59 fix above), so an agency member with genuine access to this location
// (agency_owner/admin implicitly, agency_staff via explicit businessIds — see
// middleware/tenant.ts's resolveTenantAccess) can run an import.
menuRouter.post(
  "/import/preview",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(previewMenuImport)
);
menuRouter.post(
  "/import/commit",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(commitMenuImport)
);
menuRouter.get(
  "/import/:importId",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.read"),
  asyncHandler(getMenuImportReport)
);
