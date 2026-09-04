import mongoose, { type HydratedDocument } from "mongoose";
import type { CreateOrderInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { Order } from "../models/Order.js";
import { Table, type TableDoc } from "../models/Table.js";
import { ApiError } from "../utils/ApiError.js";
import { earnPoints, redeemPoints } from "../services/loyalty.service.js";
import { priceOrderItems } from "../services/orderPricing.service.js";
import { recordPromoUsage, validatePromoCode } from "../services/promotion.service.js";
import { nextOrderNumber } from "../services/orderNumber.service.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";
import { emitOrderEvent } from "../events/orderEvents.js";
import { checkDeliveryEligibility } from "../services/delivery.service.js";

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface CreateOrderForCustomerParams {
  restaurantId: string;
  customerId: string;
  /** "online" for the customer-facing checkout, "pos" for the staff terminal — see
   *  types/order.ts's OrderChannel doc comment. */
  channel: "online" | "pos";
  items: CreateOrderInput["items"];
  orderType: CreateOrderInput["orderType"];
  paymentMethod: "cash" | "card" | "online";
  deliveryAddress?: CreateOrderInput["deliveryAddress"];
  /** The QR token a customer's own session resolved — re-validated from scratch here, never
   *  trusted. Mutually exclusive with `tableId` below; exactly one is used per orderType dine_in
   *  caller (createOrder passes tableToken, the POS controller passes tableId). */
  tableToken?: string;
  /** A staff-selected table id (POS only). Safe to trust directly — unlike a public QR token, this
   *  only ever reaches here from an already-authenticated, tenant-matched, restaurant.pos.operate
   *  staff member (see pos.controller.ts), so the same re-validate-from-scratch caution the public
   *  flow needs doesn't apply; it's still re-checked against restaurantId + isActive below, exactly
   *  like every other tenant-scoped staff write in this codebase. */
  tableId?: string;
  customerNotes?: string;
  redeemPoints?: number;
  promoCode?: string;
  /** True only for a throwaway isDemoAccount:true customer (public marketing playground) — see
   *  Order.isDemo's own doc comment. Always false for POS orders; they're real sales. */
  isDemoAccount?: boolean;
  /** POS-only: staff collects cash/card payment in the same motion as ringing up the sale, so the
   *  order is created already paid rather than requiring a second updateOrderPaymentStatus call.
   *  Never available to the public customer-facing path — createOrderSchema has no field for this,
   *  so there is no way a customer request body could set it. Ignored for "online" (that lifecycle
   *  is exclusively driven by the Payment webhook, same as always). */
  markPaidImmediately?: boolean;
}

export interface CreatedOrderResult {
  id: string;
  orderNumber: string;
  [key: string]: unknown;
}

/**
 * The one canonical order-creation path — extracted from order.controller.ts's createOrder
 * (customer-facing checkout) so the new POS flow (pos.controller.ts) creates orders through the
 * exact same pricing/availability/delivery/promo/loyalty/transaction logic instead of a second,
 * drifting copy of it. Every existing customer-facing behavior (availability checks, settings
 * gates, re-derived pricing, promo/loyalty handling, the single DB transaction, the emitted
 * order.created event) is unchanged — callers only differ in how they obtain `customerId` and,
 * for dine-in, whether they supply a customer-scanned `tableToken` or a staff-selected `tableId`.
 */
export async function createOrderForCustomer(params: CreateOrderForCustomerParams): Promise<CreatedOrderResult> {
  const {
    restaurantId,
    customerId,
    channel,
    items,
    orderType,
    paymentMethod,
    deliveryAddress,
    tableToken,
    tableId,
    customerNotes,
    redeemPoints: pointsToRedeem = 0,
    promoCode,
    isDemoAccount = false,
    markPaidImmediately = false,
  } = params;

  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const { settings } = restaurant;
  const availability = computeAvailability(settings);
  if (availability.status === "closed") {
    throw ApiError.badRequest("This restaurant is not accepting orders right now");
  }
  if (availability.status === "paused") {
    throw ApiError.badRequest(availability.reason || "This restaurant has temporarily paused ordering");
  }
  if (orderType === "pickup" && !settings.pickupEnabled) throw ApiError.badRequest("Pickup is not available");
  if (orderType === "dine_in" && !settings.dineInEnabled) throw ApiError.badRequest("Dine-in ordering is not available");

  // "card" reuses cashEnabled's gate — see Order.ts's paymentMethod comment for why the two are
  // treated as the same "staff-collected, manually recorded" payment class.
  if ((paymentMethod === "cash" || paymentMethod === "card") && !settings.cashEnabled) {
    throw ApiError.badRequest("In-person payment is not available");
  }
  if (paymentMethod === "online" && !settings.onlinePaymentEnabled) throw ApiError.badRequest("Online payment is not available");

  let table: HydratedDocument<TableDoc> | null = null;
  if (orderType === "dine_in") {
    if (tableId) {
      table = await Table.findOne({ _id: tableId, restaurantId, isActive: true });
      if (!table) throw ApiError.badRequest("This table is not available");
    } else {
      table = await Table.findOne({ restaurantId, qrToken: tableToken, isActive: true });
      if (!table) throw ApiError.badRequest("This table is no longer valid — please scan the QR code again");
    }
  }

  let deliveryDistanceKm: number | undefined;
  let resolvedDeliveryFee = 0;
  if (orderType === "delivery") {
    const eligibility = checkDeliveryEligibility(restaurant, deliveryAddress!.latitude, deliveryAddress!.longitude);
    if (!eligibility.eligible) {
      throw ApiError.badRequest(eligibility.reason ?? "Delivery is not available to this address");
    }
    deliveryDistanceKm = eligibility.distanceKm;
    resolvedDeliveryFee = eligibility.deliveryFee ?? settings.deliveryFee;
  }

  const { items: pricedItems, subtotal } = await priceOrderItems(restaurantId, items);

  if (subtotal < settings.minOrderAmount) {
    throw ApiError.badRequest(`Minimum order amount is ${settings.minOrderAmount}`);
  }

  const appliedPromo = promoCode
    ? await validatePromoCode(restaurantId, promoCode, subtotal, restaurant.businessId?.toString())
    : null;
  const promoDiscount = appliedPromo?.discount ?? 0;

  const loyaltyDiscount = Math.min(pointsToRedeem, subtotal);
  const taxableAmount = Math.max(0, subtotal - loyaltyDiscount - promoDiscount);
  const taxAmount = roundCurrency(taxableAmount * settings.taxRate);
  const deliveryFee = orderType === "delivery" ? resolvedDeliveryFee : 0;
  const total = roundCurrency(taxableAmount + taxAmount + deliveryFee);

  const session = await mongoose.startSession();
  try {
    let createdOrder;
    await session.withTransaction(async () => {
      const orderNumber = await nextOrderNumber(restaurant._id, session);

      const [order] = await Order.create(
        [
          {
            restaurantId,
            customerId,
            orderNumber,
            items: pricedItems,
            orderType,
            channel,
            paymentMethod,
            paymentStatus: markPaidImmediately && paymentMethod !== "online" ? "paid" : "unpaid",
            currency: settings.currency,
            subtotal,
            taxAmount,
            deliveryFee,
            discount: loyaltyDiscount,
            promoCode: appliedPromo?.promotion.code,
            promoDiscount,
            total,
            loyaltyPointsRedeemed: loyaltyDiscount,
            loyaltyPointsEarned: 0,
            deliveryAddress: orderType === "delivery" ? deliveryAddress : undefined,
            deliveryDistanceKm: orderType === "delivery" ? deliveryDistanceKm : undefined,
            tableId: table?._id,
            tableName: table?.name,
            customerNotes,
            statusHistory: [{ status: "pending", at: new Date() }],
            isDemo: isDemoAccount,
          },
        ],
        { session }
      );

      if (loyaltyDiscount > 0) {
        await redeemPoints(restaurantId, customerId, loyaltyDiscount, order.id, session);
      }
      if (appliedPromo) {
        const recorded = await recordPromoUsage(appliedPromo.promotion.id, session);
        if (!recorded) {
          throw ApiError.conflict("This promo code just reached its usage limit — please remove it and try again");
        }
      }

      const earned = await earnPoints(restaurantId, customerId, order.id, total, session);
      order.loyaltyPointsEarned = earned;
      await order.save({ session });
      createdOrder = order.toJSON();
    });

    const created = createdOrder as unknown as CreatedOrderResult;
    emitOrderEvent("order.created", {
      orderId: created.id,
      orderNumber: created.orderNumber,
      restaurantId,
      customerId,
      status: "pending",
    });
    return created;
  } finally {
    await session.endSession();
  }
}
