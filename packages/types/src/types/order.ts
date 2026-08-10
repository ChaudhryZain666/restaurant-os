export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  restaurantId: string;
  customerId: string;
  items: OrderItem[];
  status: OrderStatus;
  subtotal: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  total: number;
  createdAt: string;
}
