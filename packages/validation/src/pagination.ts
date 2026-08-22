import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * page/limit — the query-side half of Phase 12's shared pagination convention (see
 * apps/api/src/utils/pagination.ts for the response-side helpers and
 * packages/types/src/types/api.ts's Paginated<T> for the envelope). Every paginated list
 * endpoint's own query schema starts from `.extend(paginationQueryShape)` rather than
 * redeclaring page/limit, so the bounds (min page 1, max limit 100) are enforced in exactly one
 * place. Coerced from query-string values, which always arrive as strings.
 */
export const paginationQueryShape = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
};

export const paginationQuerySchema = z.object(paginationQueryShape);
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;

/**
 * A `sort`/`order` pair restricted to a fixed field whitelist. This is the ONLY sanctioned way a
 * client-influenced value is allowed to reach a Mongo sort key: every endpoint declares its own
 * whitelist here, so a request can never pass an arbitrary field name for the server to
 * interpolate into `.sort({ [field]: ... })` — trying to sort by an un-whitelisted field simply
 * fails validation (400), the same way an un-whitelisted filter field would.
 */
export function sortableQueryShape<T extends [string, ...string[]]>(fields: T, defaultField: T[number]) {
  return {
    sort: z.enum(fields).default(defaultField),
    order: z.enum(["asc", "desc"]).default("desc"),
  };
}

/**
 * A boolean query-string filter, parsed correctly. `z.coerce.boolean()` is a trap for this: it
 * just runs `Boolean(value)`, and `Boolean("false")` is `true` (any non-empty string is truthy)
 * — so `?isActive=false` would silently coerce to `true` and return the OPPOSITE of what was
 * asked for. This only accepts the literal strings "true"/"false".
 */
export function booleanQueryParam() {
  return z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"));
}
