import type { Request, Response } from "express";
import { Types, type PipelineStage } from "mongoose";
import type { ListCustomerOrdersQueryInput, ListRestaurantCustomersQueryInput } from "@restaurant/validation";
import type { RestaurantCustomerSummary } from "@restaurant/types";
import { Order, type OrderDoc } from "../models/Order.js";
import { sendSuccess } from "../common/response.js";
import { escapeRegex, paginateAggregate, paginateQuery } from "../utils/pagination.js";

const SORT_FIELD_MAP: Record<ListRestaurantCustomersQueryInput["sort"], string> = {
  lastOrderAt: "lastOrderAt",
  totalSpent: "totalSpent",
  totalOrders: "totalOrders",
  name: "name",
};

/**
 * GET /restaurants/:restaurantId/customers — a real, server-side, paginated replacement for what
 * CustomersPage used to build itself by fetching the restaurant's ENTIRE order history and
 * grouping it client-side (see the removed comment on apps/admin's CustomersPage.tsx). Every
 * number here is computed by the same $group this endpoint runs, not re-derived per page load in
 * the browser — and it now scales with an aggregation + $facet page, not "download everything."
 */
export async function listRestaurantCustomers(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { page, limit, search, sort, order } = req.query as unknown as ListRestaurantCustomersQueryInput;

  const pipeline: PipelineStage[] = [
    { $match: { restaurantId: new Types.ObjectId(restaurantId) } },
    {
      $group: {
        _id: "$customerId",
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$total", 0] } },
        paidOrders: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
        firstOrderAt: { $min: "$createdAt" },
        lastOrderAt: { $max: "$createdAt" },
      },
    },
    // Name/email/phone live on the User document, not on Order — a $lookup here (rather than a
    // second round-trip after pagination) is what lets `search` filter by them directly in the
    // same pipeline the $facet/count below runs against, so the total always matches what's shown.
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "customer" } },
    { $unwind: "$customer" },
  ];

  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    // Phone added (POS phase) — a walk-in customer is far more often searched for by phone number
    // than name or email at a register.
    pipeline.push({ $match: { $or: [{ "customer.name": re }, { "customer.email": re }, { "customer.phone": re }] } });
  }

  pipeline.push(
    {
      $project: {
        _id: 0,
        customerId: "$_id",
        name: "$customer.name",
        email: "$customer.email",
        phone: "$customer.phone",
        totalOrders: 1,
        totalSpent: 1,
        avgOrderValue: {
          $cond: [{ $gt: ["$paidOrders", 0] }, { $divide: ["$totalSpent", "$paidOrders"] }, 0],
        },
        firstOrderAt: 1,
        lastOrderAt: 1,
      },
    },
    { $sort: { [SORT_FIELD_MAP[sort]]: order === "asc" ? 1 : -1 } }
  );

  const result = await paginateAggregate<RestaurantCustomerSummary, OrderDoc>(Order, pipeline, { page, limit });
  sendSuccess(res, result);
}

/**
 * GET /restaurants/:restaurantId/customers/:customerId/orders — the drill-down behind a
 * CustomersPage row. Deliberately a second, separately-paginated endpoint rather than reviving
 * the old "fetch this customer's whole order history" approach the aggregation above replaced —
 * it's bounded the same way listMyOrders is (see order.controller.ts), just tenant-scoped instead
 * of self-scoped. Not stripped of internalNote: the caller already holds restaurant.orders.read
 * for this tenant, same as listRestaurantOrders shows staff the full order.
 */
export async function listCustomerOrders(req: Request, res: Response) {
  const { restaurantId, customerId } = req.params;
  const { page, limit } = req.query as unknown as ListCustomerOrdersQueryInput;
  const result = await paginateQuery(
    Order.find({ restaurantId, customerId }).sort({ createdAt: -1 }),
    { page, limit }
  );
  sendSuccess(res, { ...result, items: result.items.map((o) => o.toJSON()) });
}
