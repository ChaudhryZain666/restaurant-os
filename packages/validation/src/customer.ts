import { z } from "zod";
import { paginationQueryShape, sortableQueryShape } from "./pagination.js";

export const listRestaurantCustomersQuerySchema = z.object({
  ...paginationQueryShape,
  ...sortableQueryShape(["lastOrderAt", "totalSpent", "totalOrders", "name"], "lastOrderAt"),
  search: z.string().trim().max(100).optional(),
});
export type ListRestaurantCustomersQueryInput = z.infer<typeof listRestaurantCustomersQuerySchema>;

// GET /restaurants/:restaurantId/customers/:customerId/orders — the drill-down behind a Customers
// row, restored on top of the scalable aggregation above rather than by going back to fetching
// a customer's entire order history unbounded (Phase 12's shared pagination convention).
export const listCustomerOrdersQuerySchema = z.object(paginationQueryShape);
export type ListCustomerOrdersQueryInput = z.infer<typeof listCustomerOrdersQuerySchema>;
