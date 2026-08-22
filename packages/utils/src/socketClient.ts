import { io, type Socket } from "socket.io-client";

export type { Socket } from "socket.io-client";

/**
 * Thin wrapper around socket.io-client's own (already robust) reconnection handling — no custom
 * backoff/retry loop is written here, socket.io-client already does exponential backoff and
 * automatic reconnection out of the box. The one thing worth wrapping: `auth` is a FUNCTION, not
 * a fixed value, so every (re)connection attempt — including automatic ones after a network blip
 * — reads the CURRENT access token via getToken() rather than whatever token was valid when
 * connect() was first called. A stale captured token would silently break reconnection after a
 * refresh rotated it.
 *
 * This is a notification channel, not a source of truth: callers should treat every event as
 * "something changed, go re-fetch," never as the state itself — see each app's useOrderEvents/
 * useRestaurantOrderEvents hook.
 *
 * Phase 19 — `getLocationId` is optional (apps/web has no multi-location concept and never passes
 * it): when present, its current value is sent alongside the token on every (re)connection
 * attempt, the same "always read fresh, never capture stale" reasoning as the token itself. The
 * server verifies it against the token's own claims before honoring it (see
 * apps/api/src/realtime/socket.ts) — this is never trusted on its own, exactly like a URL param.
 */
export function createSocketClient(url: string, getToken: () => string | null, getLocationId?: () => string | null): Socket {
  return io(url, {
    autoConnect: false,
    auth: (cb) => cb({ token: getToken(), locationId: getLocationId?.() ?? undefined }),
  });
}
