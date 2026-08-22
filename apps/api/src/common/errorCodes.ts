export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  // Phase 21 — this restaurant's menu is now managed at the business level; the legacy
  // per-location write endpoint that returned this is permanently retired for it.
  MENU_MIGRATED: "MENU_MIGRATED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
