import type { SelectedModifier } from "./modifier.js";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type OrderType = "pickup" | "delivery";

export type PaymentStatus = "unpaid" | "paid";

export interface OrderItem {
  menuItemId: string;
  name: string;
  /** Base unit price at the time of ordering — never re-read from the live MenuItem later. */
  unitPrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  /** (unitPrice + sum(selectedModifiers.priceAdjustment)) * quantity */
  lineTotal: number;
}

export interface Order {
  id: string;
  restaurantId: string;
  customerId: string;
  orderNumber: string;
  items: OrderItem[];
  status: OrderStatus;
  orderType: OrderType;
  paymentStatus: PaymentStatus;
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  discount: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  total: number;
  deliveryAddress?: string;
  customerNotes?: string;
  createdAt: string;
  /** Only present on staff-facing responses (listRestaurantOrders / getOrder as staff). */
  customerName?: string;
  customerPhone?: string;
}
