/**
 * Phase 85A — the single list of GarnishTable's own browser origins (docs/production-architecture.md):
 * storefront (CLIENT_ORIGIN), Owner Portal (ADMIN_ORIGIN), marketing (MARKETING_ORIGIN), and the
 * other surfaces of the same admin build — Agency Portal, Platform Admin, POS (PORTAL_ORIGINS).
 * Restaurants' own custom domains are deliberately NOT here: they're tenant data, resolved at
 * request time (see realtime/socket.ts), never part of static configuration.
 */
interface OriginConfig {
  CLIENT_ORIGIN: string;
  ADMIN_ORIGIN: string;
  MARKETING_ORIGIN: string;
  PORTAL_ORIGINS: string[];
}

/** Hostnames of every GarnishTable surface, including the API — none of them (or anything under
 *  them) can be claimed as a restaurant's custom domain. */
export function platformHostnames(config: OriginConfig & { API_PUBLIC_ORIGIN: string }): string[] {
  const origins = [...httpCorsOrigins(config), config.API_PUBLIC_ORIGIN];
  return [...new Set(origins.map((origin) => new URL(origin).hostname.toLowerCase()))];
}

/** Origins allowed to make credentialed HTTP requests to the API (Express CORS). */
export function httpCorsOrigins(config: OriginConfig): string[] {
  return [...new Set([config.CLIENT_ORIGIN, config.ADMIN_ORIGIN, config.MARKETING_ORIGIN, ...config.PORTAL_ORIGINS])];
}

/** Origins allowed to open a Socket.IO connection. Marketing never opens one. */
export function realtimeOrigins(config: OriginConfig): string[] {
  return [...new Set([config.CLIENT_ORIGIN, config.ADMIN_ORIGIN, ...config.PORTAL_ORIGINS])];
}
