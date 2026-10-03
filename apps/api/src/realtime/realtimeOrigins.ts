import { resolveCustomDomain } from "../services/customDomain.service.js";

type OriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * Phase 85A — Socket.IO's origin check. GarnishTable's own surfaces are a static list; a
 * restaurant's custom domain is tenant data, so it's checked against DomainMapping at connect time
 * (a storefront on `orders.somerestaurant.com` opens its socket from that origin).
 *
 * A request with no Origin header is not a browser page and is let through, exactly as the
 * previous static-array configuration behaved: CORS is a browser control, and every socket is
 * still authenticated by its handshake token regardless of origin.
 */
export function createRealtimeOriginCheck(staticOrigins: string[], isCustomDomainOrigin: (origin: string) => Promise<boolean>) {
  const allowed = new Set(staticOrigins);
  return (origin: string | undefined, callback: OriginCallback) => {
    if (!origin || allowed.has(origin)) {
      callback(null, true);
      return;
    }
    isCustomDomainOrigin(origin).then(
      (ok) => callback(null, ok),
      () => callback(null, false)
    );
  };
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;
const cache = new Map<string, { allowed: boolean; expiresAt: number }>();

/** True when `origin` is an https origin whose hostname is a LIVE custom domain — the same
 *  decision the storefront and the TLS edge use (customDomain.service.ts). Cached briefly so a
 *  reconnect storm doesn't become a query storm; a domain deactivated in the admin stops being
 *  accepted within CACHE_TTL_MS. */
export async function isActiveCustomDomainOrigin(origin: string, now = Date.now()): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Custom domains are only ever served over TLS (docs/custom-domains-infrastructure-contract.md).
  if (url.protocol !== "https:" || url.origin !== origin) return false;
  const hostname = url.hostname.toLowerCase();

  const cached = cache.get(hostname);
  if (cached && cached.expiresAt > now) return cached.allowed;

  const allowed = (await resolveCustomDomain(hostname)).live;
  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(hostname, { allowed, expiresAt: now + CACHE_TTL_MS });
  return allowed;
}

/** Test-only. */
export function clearRealtimeOriginCache(): void {
  cache.clear();
}
