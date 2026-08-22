import type { Model, PipelineStage, Query } from "mongoose";

export interface PaginationParams {
  page: number;
  limit: number;
}

/** Matches @restaurant/types' Paginated<T> exactly — the one envelope every paginated list
 *  endpoint returns. */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

function buildEnvelope<T>(items: T[], total: number, { page, limit }: PaginationParams): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    items,
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Paginates a Mongoose find() query — e.g. `paginateQuery(Order.find({ customerId }).sort(...),
 * { page, limit })`. Runs the page fetch and a count in parallel, both against the exact filter
 * already set on the query (via `query.getFilter()`), so the two can never drift apart.
 */
export async function paginateQuery<T>(query: Query<T[], unknown>, params: PaginationParams): Promise<PaginatedResult<T>> {
  const { page, limit } = params;
  const filter = query.getFilter();
  const model = query.model as Model<unknown>;

  const [items, total] = await Promise.all([
    query.skip((page - 1) * limit).limit(limit).exec(),
    model.countDocuments(filter),
  ]);

  return buildEnvelope(items as T[], total, params);
}

/**
 * Paginates an aggregation pipeline via `$facet` — one round trip for both the page of data and
 * the total count, computed from the identical upstream stages (`pipeline`), so — like
 * paginateQuery — the count can never be taken against a different filter than the data.
 * `pipeline` should stop right before the point you'd otherwise add your own `$sort`/pagination;
 * this appends `$skip`/`$limit` (and a `$count`) for you.
 */
export async function paginateAggregate<T, DocType = unknown>(
  model: Model<DocType>,
  pipeline: PipelineStage[],
  params: PaginationParams
): Promise<PaginatedResult<T>> {
  const { page, limit } = params;

  const [result] = await model.aggregate([
    ...pipeline,
    {
      $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  const items = (result?.data ?? []) as T[];
  const total = (result?.totalCount?.[0]?.count ?? 0) as number;
  return buildEnvelope(items, total, params);
}

/** Escapes regex metacharacters so a client-supplied search string can only ever match itself
 *  literally (case-insensitively) — never be interpreted as a regex pattern. Required before
 *  building any `new RegExp(search, "i")` filter from user input, to avoid both surprising
 *  matches (e.g. a lone "." matching anything) and pathological/ReDoS-shaped patterns. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
