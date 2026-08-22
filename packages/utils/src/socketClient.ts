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
 */
export function createSocketClient(url: string, getToken: () => string | null): Socket {
  return io(url, {
    autoConnect: false,
    auth: (cb) => cb({ token: getToken() }),
  });
}
