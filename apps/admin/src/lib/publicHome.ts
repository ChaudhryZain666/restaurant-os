import { portalHomeForOrigin, type PortalOrigins } from "./portalHosts";

/**
 * Launch, 2026-11-22 — whether "/" shows the public Owner Portal home instead of the dashboard.
 *
 * Paddle reviews app.garnishtable.com in a real browser and refused it as "restricted by a login
 * wall": a signed-out visit to "/" went straight to the sign-in form. So a SIGNED-OUT visitor to
 * "/" on the Owner Portal host now gets a public page describing the product, with sign-in,
 * free-trial and policy links. Everything else is unchanged:
 *  - while the session is still loading, nothing is decided (the existing layout shows its loader);
 *  - any signed-in user goes through the existing layout and RequireAuth, exactly as before;
 *  - every other path keeps RequireAuth's redirect to /login;
 *  - the POS, agency and platform-admin hosts keep going straight to sign-in.
 */
export function showsPublicHome(input: {
  pathname: string;
  authLoading: boolean;
  signedIn: boolean;
  origin: string;
  portals: PortalOrigins;
}): boolean {
  if (input.pathname !== "/") return false;
  if (input.authLoading || input.signedIn) return false;
  return portalHomeForOrigin(input.origin, input.portals) === null;
}
