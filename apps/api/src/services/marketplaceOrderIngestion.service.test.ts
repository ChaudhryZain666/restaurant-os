import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { MarketplaceMenuMapping } from "../models/MarketplaceMenuMapping.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { getMockMarketplaceProvider } from "../marketplaceProviders/index.js";
import { ingestMarketplaceOrder } from "./marketplaceOrderIngestion.service.js";
import { closeTestConnections, createTestBusiness, createTestCategory, createTestMenuItem, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];

async function setUp(provider: "uber_eats" | "doordash" | "foodpanda" = "uber_eats") {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  const category = await createTestCategory(restaurant._id);
  const menuItem = await createTestMenuItem(restaurant._id, category._id, { price: 12 });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string);

  const integration = await RestaurantMarketplaceIntegration.create({
    restaurantId: restaurant._id,
    businessId: business._id,
    provider,
    status: "active",
    externalStoreId: `store_${Date.now()}`,
    connectedByUserId: owner._id,
  });

  return { restaurant, business, menuItem, integration };
}

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    MarketplaceMenuMapping.deleteMany({ restaurantId: { $in: restaurantIds } }),
    MarketplaceWebhookEvent.deleteMany({}),
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("ingestMarketplaceOrder", () => {
  it("creates a real Order (channel/paymentMethod=marketplace, already paid, correct provenance) and NO Payment document", async () => {
    const { restaurant, menuItem, integration } = await setUp("uber_eats");
    await MarketplaceMenuMapping.create({
      integrationId: integration._id,
      restaurantId: restaurant._id,
      provider: "uber_eats",
      internalType: "menu_item",
      internalId: menuItem._id,
      externalId: "ext_item_1",
    });

    const mock = getMockMarketplaceProvider("uber_eats");
    const externalOrderId = `ord_${Date.now()}`;
    mock.simulateInboundOrder({
      externalOrderId,
      externalStoreId: integration.externalStoreId as string,
      externalStatus: "created",
      externalCreatedAt: new Date().toISOString(),
      customerName: "Jane Diner",
      customerPhone: "+15550001111",
      orderType: "pickup",
      items: [{ externalItemId: "ext_item_1", name: menuItem.name, quantity: 2, unitPriceCents: 1200, modifiers: [] }],
      subtotalCents: 2400,
      totalCents: 2400,
      currency: "USD",
    });

    await ingestMarketplaceOrder({
      provider: "uber_eats",
      integrationId: integration.id as string,
      externalOrderId,
      eventId: `evt_${externalOrderId}`,
    });

    const order = await Order.findOne({ restaurantId: restaurant._id, "marketplace.externalOrderId": externalOrderId });
    expect(order).toBeTruthy();
    expect(order!.channel).toBe("marketplace");
    expect(order!.paymentMethod).toBe("marketplace");
    expect(order!.paymentStatus).toBe("paid");
    expect(order!.marketplace!.provider).toBe("uber_eats");
    expect(order!.marketplace!.externalStoreId).toBe(integration.externalStoreId);
    expect(order!.items).toHaveLength(1);
    expect(order!.items[0].quantity).toBe(2);

    const payment = await Payment.findOne({ orderId: order!._id });
    expect(payment).toBeNull();

    expect(mock.wasAccepted(externalOrderId)).toBe(true);
  });

  it("denies (never guesses) an order containing an item with no MarketplaceMenuMapping row, and creates no Order", async () => {
    const { restaurant, integration } = await setUp("doordash");
    const mock = getMockMarketplaceProvider("doordash");
    const externalOrderId = `ord_unmapped_${Date.now()}`;
    mock.simulateInboundOrder({
      externalOrderId,
      externalStoreId: integration.externalStoreId as string,
      externalStatus: "created",
      externalCreatedAt: new Date().toISOString(),
      orderType: "pickup",
      items: [{ externalItemId: "some_unmapped_item", name: "Mystery Item", quantity: 1, unitPriceCents: 500, modifiers: [] }],
      subtotalCents: 500,
      totalCents: 500,
      currency: "USD",
    });

    await ingestMarketplaceOrder({
      provider: "doordash",
      integrationId: integration.id as string,
      externalOrderId,
      eventId: `evt_${externalOrderId}`,
    });

    const order = await Order.findOne({ restaurantId: restaurant._id, "marketplace.externalOrderId": externalOrderId });
    expect(order).toBeNull();
  });

  it("a second ingestion attempt for the same external order is a safe no-op (Order's unique index backstop), never a second Order", async () => {
    const { restaurant, menuItem, integration } = await setUp("foodpanda");
    await MarketplaceMenuMapping.create({
      integrationId: integration._id,
      restaurantId: restaurant._id,
      provider: "foodpanda",
      internalType: "menu_item",
      internalId: menuItem._id,
      externalId: "ext_item_dup",
    });
    const mock = getMockMarketplaceProvider("foodpanda");
    const externalOrderId = `ord_dup_${Date.now()}`;
    mock.simulateInboundOrder({
      externalOrderId,
      externalStoreId: integration.externalStoreId as string,
      externalStatus: "created",
      externalCreatedAt: new Date().toISOString(),
      orderType: "pickup",
      items: [{ externalItemId: "ext_item_dup", name: "Item", quantity: 1, unitPriceCents: 1200, modifiers: [] }],
      subtotalCents: 1200,
      totalCents: 1200,
      currency: "USD",
    });

    const params = { provider: "foodpanda" as const, integrationId: integration.id as string, externalOrderId, eventId: `evt_${externalOrderId}` };
    await ingestMarketplaceOrder(params);
    await ingestMarketplaceOrder({ ...params, eventId: `evt_${externalOrderId}_retry` }); // simulates a redelivered webhook with a different eventId but the same order

    const count = await Order.countDocuments({ restaurantId: restaurant._id, "marketplace.externalOrderId": externalOrderId });
    expect(count).toBe(1);
  });

  it("does nothing when the integration is not active (e.g. disconnected mid-flight)", async () => {
    const { restaurant, integration } = await setUp("uber_eats");
    await RestaurantMarketplaceIntegration.updateOne({ _id: integration._id }, { $set: { status: "disconnected" } });

    await ingestMarketplaceOrder({
      provider: "uber_eats",
      integrationId: integration.id as string,
      externalOrderId: "irrelevant",
      eventId: "evt_irrelevant",
    });

    const count = await Order.countDocuments({ restaurantId: restaurant._id });
    expect(count).toBe(0);
  });

  it("marks the originating MarketplaceWebhookEvent processed once ingestion concludes", async () => {
    const { restaurant, menuItem, integration } = await setUp("uber_eats");
    await MarketplaceMenuMapping.create({
      integrationId: integration._id,
      restaurantId: restaurant._id,
      provider: "uber_eats",
      internalType: "menu_item",
      internalId: menuItem._id,
      externalId: "ext_item_evt",
    });
    const eventId = `evt_${Date.now()}`;
    await MarketplaceWebhookEvent.create({ provider: "uber_eats", eventId, eventType: "orders.notification", processingStartedAt: new Date() });

    const mock = getMockMarketplaceProvider("uber_eats");
    const externalOrderId = `ord_evt_${Date.now()}`;
    mock.simulateInboundOrder({
      externalOrderId,
      externalStoreId: integration.externalStoreId as string,
      externalStatus: "created",
      externalCreatedAt: new Date().toISOString(),
      orderType: "pickup",
      items: [{ externalItemId: "ext_item_evt", name: "Item", quantity: 1, unitPriceCents: 1000, modifiers: [] }],
      subtotalCents: 1000,
      totalCents: 1000,
      currency: "USD",
    });

    await ingestMarketplaceOrder({ provider: "uber_eats", integrationId: integration.id as string, externalOrderId, eventId });

    const event = await MarketplaceWebhookEvent.findOne({ provider: "uber_eats", eventId });
    expect(event!.processedAt).toBeTruthy();
  });
});
