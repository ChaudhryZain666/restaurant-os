import { Business } from "../models/Business.js";

/**
 * Platform admin as a restaurant's owner of record (e.g. the GarnishTable demo restaurant).
 *
 * A platform admin's own site role grants no restaurant permissions (restaurant.* is owner/staff
 * only), so it can't run a restaurant just by being an admin. When a platform admin's user id IS
 * the `ownerId` of a Business — set deliberately, e.g. by scripts/transferDemoOwnership.ts — that
 * admin may act as the restaurant_owner for THAT business and its locations, and nothing else.
 *
 * Re-checked against the database on every request (never trusted from a token claim or the
 * client), so moving ownership back revokes it immediately. Every other platform-admin behavior is
 * unchanged.
 */
export async function platformAdminOwnsBusiness(
  user: { id?: string; role: string } | undefined,
  businessId: unknown
): Promise<boolean> {
  if (!user?.id || user.role !== "platform_admin" || !businessId) return false;
  try {
    return Boolean(await Business.exists({ _id: businessId, ownerId: user.id }));
  } catch {
    return false; // a malformed id reads as "not owned"
  }
}

/** The effective role for permission checks when acting as owner of record. */
export const OWNER_OF_RECORD_ROLE = "restaurant_owner" as const;
