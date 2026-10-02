import { isIP } from "node:net";

/**
 * Phase 85A — the value handed to Express's `app.set("trust proxy", ...)`.
 *
 * Every request in production reaches the API through an edge/reverse proxy (TLS termination, and
 * the same-origin `/api` forwarding every frontend relies on — see docs/production-architecture.md).
 * Without "trust proxy", `req.ip` is the edge's address for every user, so every rate limiter in
 * this API (all keyed by `req.ip`) becomes one bucket shared by the whole platform.
 *
 * Accepted TRUST_PROXY values:
 *  - unset / "" / "false" / "none" / "0" → trust nothing (`req.ip` is the socket peer).
 *  - a hop count, "1".."10" → trust that many proxies in front of the API. Correct only when the API
 *    is NOT reachable except through those proxies (otherwise a direct caller can forge
 *    X-Forwarded-For and pick its own rate-limit bucket).
 *  - a comma-separated list of proxy addresses: IPs, CIDR ranges, or Express's named ranges
 *    ("loopback", "linklocal", "uniquelocal"). X-Forwarded-For is only honoured when the connection
 *    actually comes from one of them — the safe choice whenever the API port is reachable directly.
 *
 * "true" / "*" (trust every hop) is refused outright: with it, `req.ip` becomes the LEFTMOST
 * X-Forwarded-For entry, which the client writes itself — any caller could rotate it per request
 * and walk straight past the auth/signup/contact limiters.
 */
export type TrustProxySetting = false | number | string[];

const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);
const MAX_HOPS = 10;

export class TrustProxyConfigError extends Error {}

function isValidProxyAddress(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split("/");
  if (rest.length > 0) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "false" || value === "none" || value === "0") return false;
  if (value === "true" || value === "*" || value === "all") {
    throw new TrustProxyConfigError(
      `TRUST_PROXY="${raw}" would trust every X-Forwarded-For hop, letting any client choose its own IP (and rate-limit bucket). ` +
        "Use the number of proxies in front of the API, or the proxies' addresses/CIDR ranges."
    );
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops > MAX_HOPS) {
      throw new TrustProxyConfigError(`TRUST_PROXY="${raw}" is not a plausible proxy hop count (1-${MAX_HOPS}).`);
    }
    return hops;
  }
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = entries.filter((entry) => !isValidProxyAddress(entry));
  if (entries.length === 0 || invalid.length > 0) {
    throw new TrustProxyConfigError(
      `TRUST_PROXY="${raw}" is not valid — expected a hop count, or IPs/CIDR ranges/"loopback"/"linklocal"/"uniquelocal" (invalid: ${invalid.join(", ") || "empty list"}).`
    );
  }
  return entries;
}
