# Pagination & RBAC Architecture (Phase 12)

Two structural fixes from the Phase 12 scalability/architecture pass, each chosen specifically to
avoid patching individual symptoms where a shared convention was the right level of fix.

## Shared server-side pagination

**Problem this replaces:** every list endpoint in the API (customer order history, restaurant
admin order/customer views, platform restaurant/user lists, the audit log) either fetched its
entire unbounded result set (`Model.find(filter)` with no `skip`/`limit` at all) or capped it with
an ad hoc defensive `.limit(N)` that just silently truncated results rather than actually
paginating. `apps/admin`'s Customers page went further: it derived its data by fetching a
restaurant's *entire order history* into the browser and grouping it client-side.

**The convention, not four separate fixes:**

- **Query shape** — `packages/validation/src/pagination.ts`:
  - `paginationQueryShape` — `{ page: number (default 1, min 1), limit: number (default 20, max
    100) }`, spread into every paginated endpoint's own Zod schema via `z.object({
    ...paginationQueryShape, ...yourOwnFields })`.
  - `sortableQueryShape(fields, defaultField)` — builds a `{ sort, order }` pair restricted to a
    fixed `z.enum(fields)` whitelist. This is the **only** sanctioned way a client-influenced value
    reaches a Mongo sort key — no endpoint ever interpolates a raw client string into
    `.sort({ [field]: ... })`; an unlisted field simply fails validation (400).
  - `booleanQueryParam()` — a `?flag=true|false` parser. Exists because `z.coerce.boolean()` is a
    real trap here: it's just `Boolean(value)`, and `Boolean("false")` is `true` (any non-empty
    string is truthy) — a naive coercion would make `?isActive=false` silently return the
    *opposite* of what was asked. Caught by this phase's own test suite before shipping (see
    `platform.controller.test.ts`).
- **Response envelope** — `Paginated<T>` in `packages/types/src/types/api.ts`: `{ items, page,
  limit, total, totalPages, hasNextPage, hasPreviousPage }`. Every paginated endpoint returns
  exactly this shape (via the helpers below spread into `sendSuccess`), so frontend pages never
  each re-derive paging math from `total`/`limit` independently.
- **Backend helpers** — `apps/api/src/utils/pagination.ts`:
  - `paginateQuery(query, { page, limit })` — wraps a Mongoose `find()` query. Runs the page fetch
    and a `countDocuments` in parallel against the **exact filter already set on the query**
    (`query.getFilter()`), so count and data can never drift apart.
  - `paginateAggregate(model, pipeline, { page, limit })` — appends a `$facet` stage (`data` +
    `totalCount`) to an aggregation pipeline, for the cases a plain `find()` can't express (the
    admin Customers endpoint groups Orders by `customerId` and needs the count computed from the
    same grouped shape, not the raw Order collection).
  - `escapeRegex(value)` — required before building any `new RegExp(search, "i")` filter from
    client input, so a search string can only ever match itself literally, never be interpreted as
    a regex pattern (surprising matches, or a pathological/ReDoS-shaped pattern).
- **Frontend** — `packages/ui/src/Pagination.tsx`, a small presentational Prev/Next component
  (`page`/`totalPages`/`hasNextPage`/`hasPreviousPage`/`onPageChange`). Deliberately *not* a data
  hook — each page's existing `useEffect` + `apiClient.request` fetch pattern already worked fine
  and stays; only the paging *controls* are shared.

**Applied to:** `GET /orders/mine` (customer order history), `GET
/restaurants/:id/customers` (new — real Mongo aggregation, replacing the old
fetch-everything-and-group-client-side page), `GET /platform/restaurants`, `GET /platform/users`,
`GET /restaurants/:id/audit-log`. Any future unbounded list endpoint should start from this
convention rather than inventing its own `skip`/`limit` handling.

**Indexing:** `Order` gained a `{ customerId: 1, createdAt: -1 }` compound index — the existing
`customerId` index alone supported the equality filter on `/orders/mine` but not an efficient
sort, so paginating it would have required an in-memory sort of every matching document before
`skip`/`limit` could apply.

## RBAC: frontend authorization derived from the backend permission model

**Problem this replaces:** `apps/admin`'s route guards (`App.tsx`'s `RequireAuth roles={[...]}`)
and nav visibility (`Layout.tsx`'s `NavItem.roles`) were hand-maintained arrays of `UserRole`,
duplicating — and liable to drift from — the actual permission grants in
`packages/types/src/types/rbac.ts`'s `ROLE_PERMISSIONS`, the map the backend's
`requirePermission()` middleware actually enforces. A Phase 11 audit found exactly this drift
(`restaurant_staff` could see "Delivery"/"Loyalty" nav links that 403'd on click); Phase 12 fixed
the *pattern*, not just those two instances.

**The fix:** `RequireAuth` (`apps/admin/src/components/RequireAuth.tsx`) now accepts a
`permission?: Permission` prop, checked via `roleHasPermission(user.role, permission)` — the
same function and the same `ROLE_PERMISSIONS` table the backend reads. `Layout.tsx`'s `NavItem`
gained the identical `permission` field, and its visibility filter calls the same
`roleHasPermission()`. Every route/nav-item whose page's data comes from a permission-gated
endpoint now declares that exact permission instead of a role list — going forward, a change to
`ROLE_PERMISSIONS` propagates to both frontend gating layers automatically; there is no second
list to remember to update.

`roles?: UserRole[]` still exists on both `RequireAuth` and `NavItem`, intentionally, for the
handful of cases with no single natural backend permission to check: Dashboard and Kitchen
(visible to every restaurant-scoped role regardless of what they can do once there), and the
still-unbuilt platform `PlaceholderPage` stubs (Subscriptions, Platform analytics, System
configuration — no backend endpoint exists yet to derive a permission from).

**This is UI-layer convenience, not a second security boundary.** The backend's
`requirePermission()`/`requireTenantMatch()` middleware remains the sole authority — hiding a nav
link or redirecting a route never substitutes for server-side enforcement, and no server-side
check was weakened or removed as part of this change.

**`/menu` write-control fix:** a related, narrower bug closed in the same pass —
`restaurant_staff` could legitimately reach `/menu` (they have `restaurant.menu.read`), but
`MenuManagementPage` rendered fully-interactive Add/Edit/Delete controls to every role that could
view the page, regardless of whether they held `restaurant.menu.write` (staff never does). Those
controls now render only when `roleHasPermission(user.role, "restaurant.menu.write")` — a single
check, since every role that can reach the page at all either holds all three menu-editing
permissions together (owner, manager) or none of them (staff), so one permission check safely
gates category CRUD, item CRUD, and the modifier editor alike. See
`e2e/menu-rbac.spec.ts` for the regression test, which asserts both the UI hiding *and* that the
backend independently rejects a raw write attempt with staff's own real access token.

## `AUDIT_ACTIONS`/`AUDIT_TARGET_TYPES` drift fix (found during this pass)

A smaller instance of the same class of bug: `apps/api/src/models/AuditLog.ts` defined its own
copy of `AUDIT_ACTIONS`/`AUDIT_TARGET_TYPES`, while `packages/types`' `AuditLogEntry`-adjacent
exports had a separate, older copy that never got `"restaurant.status_changed"`/
`"user.status_changed"` or the `"restaurant"`/`"user"` target types added in Phase 11. Both now
import the single list from `packages/types/src/types/auditLog.ts`; the model file re-exports it
for existing internal callers rather than duplicating it.
