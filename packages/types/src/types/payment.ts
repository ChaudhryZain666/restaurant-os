// Named PaymentRecordStatus, not PaymentStatus: order.ts already exports PaymentStatus for
// Order.paymentStatus's simpler "unpaid"|"paid" concept, and both files are re-exported through
// this package's barrel — reusing the name would collide.
export type PaymentRecordStatus =
  | "pending"
  | "requires_action"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type PaymentMethod = "online";

export interface Payment {
  id: string;
  restaurantId: string;
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  provider: string;
  providerRef?: string;
  currency: string;
  amount: number;
  status: PaymentRecordStatus;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type RefundStatus = "pending" | "succeeded" | "failed";

export interface Refund {
  id: string;
  restaurantId: string;
  paymentId: string;
  orderId: string;
  provider: string;
  providerRefundRef?: string;
  amount: number;
  reason?: string;
  status: RefundStatus;
  initiatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}
