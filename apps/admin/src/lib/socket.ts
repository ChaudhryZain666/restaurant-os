import { createSocketClient } from "@restaurant/utils";
import { apiClient } from "./api";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** One socket for the whole app — see apps/web/src/lib/socket.ts for the identical rationale.
 *  Restaurant-scoped staff are auto-joined to their restaurant:{id} room server-side (JWT-derived,
 *  not client-supplied), so this same connection already only ever receives THEIR restaurant's
 *  order events. */
export const socket = createSocketClient(API_URL, () => apiClient.getAccessToken());
