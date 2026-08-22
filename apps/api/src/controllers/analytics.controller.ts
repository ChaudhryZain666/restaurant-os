import type { Request, Response } from "express";
import { getDailyTimeSeries, getRestaurantAnalytics } from "../services/analytics.service.js";
import { sendSuccess } from "../common/response.js";
import { ApiError } from "../utils/ApiError.js";

export async function getAnalytics(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const analytics = await getRestaurantAnalytics(restaurantId);
  sendSuccess(res, { analytics });
}

const ALLOWED_DAYS = [7, 30, 90] as const;

export async function getAnalyticsTimeSeries(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const days = Number(req.query.days ?? 30);
  if (!ALLOWED_DAYS.includes(days as (typeof ALLOWED_DAYS)[number])) {
    throw ApiError.badRequest(`days must be one of ${ALLOWED_DAYS.join(", ")}`);
  }

  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const series = await getDailyTimeSeries(restaurantId, from, to);
  sendSuccess(res, { series });
}
