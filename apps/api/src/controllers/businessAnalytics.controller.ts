import type { Request, Response } from "express";
import { sendSuccess } from "../common/response.js";
import { ApiError } from "../utils/ApiError.js";
import { MAX_RANGE_DAYS } from "../services/analytics.service.js";
import {
  getBusinessAnalyticsOverview,
  getBusinessAnalyticsProducts,
  getBusinessAnalyticsTrends,
} from "../services/businessAnalytics.service.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RANGE_DAYS = 7;

/**
 * Business-level analytics use an explicit calendar date range, not "today"/"this week" — those
 * have no single well-defined meaning across locations in different timezones (see
 * businessAnalytics.service.ts's header comment). Defaults to the last 7 days when unset.
 */
function parseDateRange(req: Request): { from: Date; to: Date } {
  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;

  const to = toParam ? new Date(`${toParam}T00:00:00.000Z`) : new Date();
  const from = fromParam
    ? new Date(`${fromParam}T00:00:00.000Z`)
    : new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);

  if (fromParam && !DATE_RE.test(fromParam)) throw ApiError.badRequest("`from` must be in YYYY-MM-DD format");
  if (toParam && !DATE_RE.test(toParam)) throw ApiError.badRequest("`to` must be in YYYY-MM-DD format");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw ApiError.badRequest("Invalid date range");
  if (to < from) throw ApiError.badRequest("`to` must not be before `from`");

  const rangeDays = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (rangeDays > MAX_RANGE_DAYS) throw ApiError.badRequest(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);

  return { from, to };
}

function parseLocationIds(req: Request): string[] | undefined {
  const raw = req.query.locationIds as string | undefined;
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function getBusinessOverview(req: Request, res: Response) {
  const { from, to } = parseDateRange(req);
  const locationIds = parseLocationIds(req);
  const overview = await getBusinessAnalyticsOverview(req.params.businessId, from, to, locationIds);
  sendSuccess(res, { overview });
}

export async function getBusinessTrends(req: Request, res: Response) {
  const { from, to } = parseDateRange(req);
  const locationIds = parseLocationIds(req);
  const trends = await getBusinessAnalyticsTrends(req.params.businessId, from, to, locationIds);
  sendSuccess(res, { trends });
}

export async function getBusinessProducts(req: Request, res: Response) {
  const { from, to } = parseDateRange(req);
  const locationIds = parseLocationIds(req);
  const products = await getBusinessAnalyticsProducts(req.params.businessId, from, to, locationIds);
  sendSuccess(res, { products });
}
