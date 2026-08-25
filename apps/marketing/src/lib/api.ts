import { createApiClient } from "@restaurant/utils";

/**
 * Phase 28 — the marketing site's first-ever API client. Deliberately minimal: this app never logs
 * in, never holds a token, and only ever calls genuinely public routes (GET /public/plans today) —
 * createApiClient's refresh/session-expiry machinery is simply unused here, not reimplemented.
 */
export const apiClient = createApiClient({ basePath: "/api/v1" });
