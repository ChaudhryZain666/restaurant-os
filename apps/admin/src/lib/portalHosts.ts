/**
 * Phase 85A — apps/admin is ONE build served on four production hostnames
 * (docs/production-architecture.md): Owner Portal (app.), Agency Portal (agency.), Platform Admin
 * (admin.) and POS (pos.). Every route exists on every hostname and access is still decided by the
 * signed-in user's role/permissions (RequireAuth) — the hostname only decides where "/" lands, so
 * pos.garnishtable.com opens the register rather than the owner dashboard.
 */
export interface PortalOrigins {
  pos?: string;
  agency?: string;
  platformAdmin?: string;
}

function normalize(origin: string | undefined): string | undefined {
  return origin?.trim().replace(/\/+$/, "").toLowerCase() || undefined;
}

/** The section "/" should open on this origin, or null for the Owner Portal (and dev/unknown hosts). */
export function portalHomeForOrigin(origin: string, portals: PortalOrigins): string | null {
  const current = normalize(origin);
  if (!current) return null;
  if (current === normalize(portals.pos)) return "/pos";
  if (current === normalize(portals.agency)) return "/agency";
  if (current === normalize(portals.platformAdmin)) return "/platform";
  return null;
}
