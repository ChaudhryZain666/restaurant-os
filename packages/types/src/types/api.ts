export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId?: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

/**
 * The one paginated-list response envelope every paginated endpoint in this API returns —
 * Phase 12's shared pagination convention (see apps/api/src/utils/pagination.ts and
 * packages/validation/src/pagination.ts for the query-side counterpart). `totalPages`/
 * `hasNextPage`/`hasPreviousPage` are derived server-side so no frontend re-derives paging math
 * from `total`/`limit` independently.
 */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
