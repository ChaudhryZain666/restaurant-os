import { createSocketClient } from "@restaurant/utils";
import { apiClient } from "./api";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// Phase 19 — mutable module-level state, same pattern apiClient itself already uses for the
// access token (setAccessToken). LocationContext calls setActiveLocationIdForSocket() whenever
// the active location changes; the socket's auth callback below always reads the CURRENT value,
// never a value captured at connect() time — required so a reconnect (whether triggered by
// LocationContext's own disconnect()+connect() on a switch, or an automatic one after a network
// blip) picks up whichever location is active right now.
let activeLocationId: string | null = null;
export function setActiveLocationIdForSocket(id: string | null) {
  activeLocationId = id;
}

/** One socket for the whole app — see apps/web/src/lib/socket.ts for the identical rationale.
 *  Restaurant-scoped staff used to be auto-joined to their restaurant:{id} room server-side purely
 *  from the JWT's baked-in restaurantId; Phase 19 layers an explicit, server-verified locationId
 *  on top (see socketClient.ts) so a multi-location owner/manager's realtime room actually follows
 *  their active-location switch rather than staying pinned to whichever restaurant they first
 *  logged into. */
export const socket = createSocketClient(API_URL, () => apiClient.getAccessToken(), () => activeLocationId);
