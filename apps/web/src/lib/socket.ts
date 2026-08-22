import { createSocketClient } from "@restaurant/utils";
import { apiClient } from "./api";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** One socket for the whole app — created once, connected/disconnected as auth state changes
 *  (see AuthContext). Never a substitute for fetching real state; see socketClient.ts's doc-comment. */
export const socket = createSocketClient(API_URL, () => apiClient.getAccessToken());
