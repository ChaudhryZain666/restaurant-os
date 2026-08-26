import type { SelectedModifier } from "./modifier.js";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type OrderType = "pickup" | "delivery" | "dine_in";

export type PaymentStatus = "unpaid" | "paid";

/** "cash" keeps the original staff-marks-it-collected lifecycle; "online" is backed by the
 *  Payment domain (see types/payment.ts) and can only become "paid" via a verified provider event. */
export type OrderPaymentMethod = "cash" | "online";

export interface OrderItem {
  menuItemId: string;
  name: string;
  /** Base unit price at the time of ordering — never re-read from the live MenuItem later. */
  unitPrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  /** (unitPrice + sum(selectedModifiers.priceAdjustment)) * quantity */
  lineTotal: number;
  /** Customer-visible ("no onions") — free text, distinct from Order.internalNote. */
  specialInstructions?: string;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  at: string;
}

/**
 * Snapshotted onto the Order at creation time (see Order.deliveryAddress below) — the same
 * snapshot-over-live-reference principle already used for order items and dine-in table names.
 * A customer editing or deleting their saved Address afterward never changes how a past order
 * reads. latitude/longitude are what the server actually validated delivery eligibility against;
 * they are always present on a delivery order (createOrder requires them), even though a saved
 * Address's coordinates are optional.
 */
export interface OrderDeliveryAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude: number;
  longitude: number;
  /** Customer-provided ("gate code, leave at door") — free text, distinct from customerNotes. */
  instructions?: string;
}

export interface Order {
  id: string;
  restaurantId: string;
  customerId: string;
  orderNumber: string;
  items: OrderItem[];
  status: OrderStatus;
  /** Every status this order has passed through, in order — powers the tracking timeline. */
  statusHistory: OrderStatusHistoryEntry[];
  orderType: OrderType;
  paymentMethod: OrderPaymentMethod;
  paymentStatus: PaymentStatus;
  /** Snapshotted from the restaurant's configured currency at order creation — see
   *  apps/api/src/models/Order.ts for why this is stored rather than always read live. */
  currency: string;
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  discount: number;
  promoCode?: string;
  promoDiscount?: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  total: number;
  deliveryAddress?: OrderDeliveryAddress;
  /** Straight-line distance (km) from the restaurant's coordinates at order creation — the same
   *  figure createOrder validated against settings.deliveryRadiusKm. Set only on delivery orders. */
  deliveryDistanceKm?: number;
  /** Set only for orderType "dine_in" — resolved server-side from a QR token at order creation,
   *  never trusted from the client directly. tableName is a snapshot (survives table rename/deletion). */
  tableId?: string;
  tableName?: string;
  customerNotes?: string;
  /** Staff-only — never present on a customer-facing response (see order.controller.ts's
   *  stripInternalFields). Only meaningful on staff-facing responses. */
  internalNote?: string;
  createdAt: string;
  /** Only present on staff-facing responses (listRestaurantOrders / getOrder as staff). */
  customerName?: string;
  customerPhone?: string;
  /** Only present on getOrder's response — the restaurant's own name/contact, attached so a
   *  printable receipt/kitchen ticket (Phase 14) doesn't need a second request. */
  restaurantName?: string;
  restaurantPhone?: string;
  restaurantAddress?: string;
  restaurantLogo?: string;
}

/** Preview returned by POST /orders/:id/reorder — not an order, a cart-population template. */
export interface ReorderPreviewItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  selectedModifiers: import("./modifier.js").SelectedModifier[];
  lineTotal: number;
}

export interface ReorderUnavailableItem {
  name: string;
  reason: string;
}

export interface ReorderPreview {
  restaurantId: string;
  /** Null only when the restaurant no longer exists/is inactive — nothing to route the customer
   *  to in that case. Otherwise the slug for building /r/:restaurantSlug/cart. */
  restaurantSlug: string | null;
  /** Whether the restaurant is currently accepting orders at all (computeAvailability's "open"). */
  restaurantAvailable: boolean;
  items: ReorderPreviewItem[];
  unavailableItems: ReorderUnavailableItem[];
  subtotal: number;
}
