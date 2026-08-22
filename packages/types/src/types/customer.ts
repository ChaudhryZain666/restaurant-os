/**
 * A restaurant's own customer, summarized from its order history — not a separate stored entity
 * (there is no Customer model; every field here is derived server-side from Orders + the
 * customer's User document at request time). See GET /restaurants/:id/customers.
 */
export interface RestaurantCustomerSummary {
  customerId: string;
  name: string;
  email: string;
  phone?: string;
  totalOrders: number;
  /** Sum of `total` across paid orders only. */
  totalSpent: number;
  /** totalSpent / (number of paid orders) — 0 if none are paid yet. */
  avgOrderValue: number;
  firstOrderAt: string;
  lastOrderAt: string;
}
