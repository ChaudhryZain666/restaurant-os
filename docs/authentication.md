# Authentication & Authorization

## Tokens

- **Access token**: JWT, 15 minute TTL, signed with `JWT_ACCESS_SECRET`. Payload:
  `{ sub: userId, role, restaurantId? }`. Sent as `Authorization: Bearer <token>`, never stored
  in a cookie (short-lived, kept in memory on the frontend).
- **Refresh token**: JWT, 30 day TTL, signed with a *different* secret (`JWT_REFRESH_SECRET`),
  stored in an `httpOnly`, `sameSite=lax` cookie scoped to `/api/v1/auth`. Each refresh token's
  `jti` is written to Redis (`refresh:<userId>:<jti>`) with a matching TTL — this is what makes
  revocation possible at all; a bare JWT can't be invalidated before it expires. Refresh **rotates**
  on every use (old `jti` deleted, new one issued) — if a stolen refresh token is used after the
  legitimate client already rotated it, the stolen one is already revoked.
- Passwords are hashed with bcrypt (cost factor 12), never logged (see the logger's redaction
  list in `apps/api/src/common/logger.ts`).

## Why a restaurantId in the access token, not looked up per-request

Putting `restaurantId` in the token (set once at login, for restaurant-scoped roles only) means
`middleware/tenant.ts` can check tenant ownership without an extra database round-trip per
request, and — more importantly — means that check is based on the *verified, signed* claim, not
on anything the client could influence. See `docs/architecture.md`'s multi-tenancy section for
why this matters.

## Roles and how a restaurant-scoped user is created

There's no self-service "sign up as a restaurant owner" flow yet — a `platform_admin` creates a
restaurant via `POST /api/v1/restaurants` with `{ name, slug, ownerId }`, where `ownerId` is an
existing user's ID. That user is upgraded to `restaurant_owner` and given the new restaurant's ID
in one step. This is intentionally minimal for Phase 0; a proper onboarding flow (self-service
restaurant creation, staff invites) is future work.

## Client-side pattern

`packages/utils`'s `createApiClient()` implements the standard flow: hold the access token in
memory, attach it to every request, and on a `401` automatically call `/auth/refresh` (which
reads the cookie) once and retry the original request. `apps/web` and `apps/admin` both use this
same client — see `docs/architecture.md` for why it's shared rather than duplicated per app.
Concurrent 401s are deduplicated (one in-flight `/auth/refresh` call, every other caller awaits
the same promise rather than racing the single-use rotating refresh token against itself). If a
401 survives a refresh attempt, the session is treated as genuinely over: the in-memory access
token is cleared and an `onSessionExpired` callback fires so `AuthContext` drops its `user` state,
which sends every `RequireAuth`-guarded page to `/login` naturally instead of retrying a doomed
refresh forever.

## Self-service account security (Phase 12)

Previously only present via the reset-password token flow (`request-password-reset` /
`reset-password`, unauthenticated). Phase 12 added the authenticated equivalents, all in
`auth.controller.ts`:

- **`POST /auth/change-password`** — requires the current password (an already-valid access token
  alone isn't enough for a change this sensitive). Revokes every other session
  (`revokeAllRefreshTokens`, the same call `resetPassword` already made) but — unlike
  `resetPassword` — immediately issues a fresh session for the request that made the change, so
  that tab isn't forced to log back in for its own action.
- **`POST /auth/request-email-change`** + **`POST /auth/confirm-email-change`** — two-step,
  mirroring the password-reset token pattern (`User.pendingEmail`/`emailChangeTokenHash`/
  `emailChangeExpiresAt`, 1-hour TTL, SHA-256 token hash only ever stored). The verification email
  is sent to the **new** address, never the old one — confirming the account holder actually
  controls that inbox is the entire point of the two-step flow. `email` itself (the real login
  identifier) is untouched until the link is used; a user who never clicks it keeps logging in
  with their original address indefinitely. Uses the same `getEmailService()`/template
  infrastructure as password reset — no new email-sending capability was needed.
- **`DELETE /auth/me`** — self-service account deletion, **customer role only**. Restaurant-scoped
  roles (owner/manager/staff/kitchen_staff) are refused outright with a clear message: what
  happens to a restaurant/its staff/its records when an owner "deletes themselves" is a product
  decision (see `docs/roadmap.md`), not something safe to guess at in this endpoint. A customer
  account has no such dependents, but `Order.customerId`/`AuditLog.actorUserId` entries still
  reference the user's id and must keep resolving for the *restaurant's own* order/audit history
  — so this **anonymizes** the document (name, email, phone, addresses scrubbed;
  `passwordHash` overwritten with an unguessable, unrelated random value; `isActive: false`;
  `deletedAt` set) rather than removing it. `isActive: false` reuses the exact same login-rejection
  path a staff-deactivated account already goes through.
