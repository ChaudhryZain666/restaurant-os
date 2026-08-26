import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getEmailService, resetEmailServiceForTests } from "../email/index.js";
import { dispatchOrderNotification } from "./notification.queue.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let customerId: string;

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant({ email: "owner@pizzeria.test", settings: { currency: "USD" } });
  const customer = await createTestUser("customer");
  customerId = customer.id;
});

afterEach(() => {
  resetEmailServiceForTests();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    Order.deleteMany({ restaurantId: restaurant._id }),
    Restaurant.deleteMany({ _id: restaurant._id }),
    User.deleteMany({ _id: customerId }),
  ]);
  await closeTestConnections();
});

describe("dispatchOrderNotification", () => {
  it("emails both the restaurant and the customer on order.created", async () => {
    const order = await createTestOrder(restaurant._id, new mongoose.Types.ObjectId(customerId), { total: 25 });
    const sendSpy = jest.spyOn(getEmailService(), "send").mockResolvedValue(undefined);

    await dispatchOrderNotification("order.created", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: restaurant.id,
      customerId,
      status: "pending",
    });

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map((call) => (call[0] as { to: string }).to);
    expect(recipients).toContain("owner@pizzeria.test");
  });

  it("emails only the customer on order.cancelled", async () => {
    const order = await createTestOrder(restaurant._id, new mongoose.Types.ObjectId(customerId), { total: 25 });
    const sendSpy = jest.spyOn(getEmailService(), "send").mockResolvedValue(undefined);

    await dispatchOrderNotification("order.cancelled", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: restaurant.id,
      customerId,
      status: "cancelled",
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((sendSpy.mock.calls[0][0] as { to: string }).to).not.toBe("owner@pizzeria.test");
  });

  it("skips the restaurant email (without throwing) when the restaurant has no email configured", async () => {
    const noEmailRestaurant = await createTestRestaurant({ settings: { currency: "USD" } });
    const order = await createTestOrder(noEmailRestaurant._id, new mongoose.Types.ObjectId(customerId), { total: 10 });
    const sendSpy = jest.spyOn(getEmailService(), "send").mockResolvedValue(undefined);

    await dispatchOrderNotification("order.created", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: noEmailRestaurant.id,
      customerId,
      status: "pending",
    });

    expect(sendSpy).toHaveBeenCalledTimes(1); // customer confirmation only
    await Promise.all([
      Order.deleteMany({ restaurantId: noEmailRestaurant._id }),
      Restaurant.deleteMany({ _id: noEmailRestaurant._id }),
    ]);
  });

  it("does nothing (and never throws) for an order that no longer exists", async () => {
    const sendSpy = jest.spyOn(getEmailService(), "send").mockResolvedValue(undefined);
    await expect(
      dispatchOrderNotification("order.created", {
        orderId: new mongoose.Types.ObjectId().toString(),
        orderNumber: "X-0000",
        restaurantId: restaurant.id,
        customerId,
        status: "pending",
      })
    ).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
