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
