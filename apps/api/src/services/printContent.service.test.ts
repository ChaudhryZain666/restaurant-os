import { describe, expect, it } from "@jest/globals";
import type { Order } from "@restaurant/types";
import { buildKitchenTicketDocument, buildReceiptDocument, buildTestDocument } from "./printContent.service.js";

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order1",
    restaurantId: "rest1",
    customerId: "cust1",
    orderNumber: "1042",
    items: [
      { menuItemId: "m1", name: "Pepperoni Pizza", unitPrice: 14.99, quantity: 1, selectedModifiers: [], lineTotal: 14.99 },
    ],
    status: "pending",
    statusHistory: [],
    orderType: "pickup",
    channel: "pos",
    paymentMethod: "cash",
    paymentStatus: "paid",
    currency: "USD",
    subtotal: 14.99,
    taxAmount: 1.2,
    deliveryFee: 0,
    discount: 0,
    loyaltyPointsEarned: 0,
    loyaltyPointsRedeemed: 0,
    total: 16.19,
    createdAt: new Date("2026-01-01T12:00:00Z").toISOString(),
    restaurantName: "Demo Restaurant",
    restaurantPhone: "555-0100",
    restaurantAddress: "123 Main St, Springfield, IL",
    ...overrides,
  };
}

function allText(lines: ReturnType<typeof buildReceiptDocument>["lines"]): string {
  return lines
    .map((l) => (l.type === "text" ? l.text : l.type === "row" ? `${l.left} ${l.right}` : ""))
    .join("\n");
}

describe("buildReceiptDocument", () => {
  it("includes restaurant identity, order number, items, totals, and payment status", () => {
    const doc = buildReceiptDocument(baseOrder(), 80);
    const text = allText(doc.lines);
    expect(text).toContain("Demo Restaurant");
    expect(text).toContain("555-0100");
    expect(text).toContain("123 Main St, Springfield, IL");
    expect(text).toContain("Order #1042");
    expect(text).toContain("Pepperoni Pizza");
    expect(text).toContain("$14.99");
    expect(text).toContain("$16.19");
    expect(text).toContain("Cash · paid");
  });

  it("shows modifiers and special instructions when present", () => {
    const order = baseOrder({
      items: [
        {
          menuItemId: "m1",
          name: "Burger",
          unitPrice: 10,
          quantity: 2,
          selectedModifiers: [{ groupId: "g1", groupName: "Cheese", optionId: "o1", optionName: "Extra cheese", priceAdjustment: 1 }],
          lineTotal: 22,
          specialInstructions: "no onions",
        },
      ],
    });
    const text = allText(buildReceiptDocument(order, 80).lines);
    expect(text).toContain("Extra cheese");
    expect(text).toContain("no onions");
  });

  it("shows discount/promo code and delivery fee only when non-zero", () => {
    const withDiscount = buildReceiptDocument(baseOrder({ discount: 2, promoCode: "SAVE2" }), 80);
    expect(allText(withDiscount.lines)).toContain("Discount (SAVE2)");

    const withoutDiscount = buildReceiptDocument(baseOrder(), 80);
    expect(allText(withoutDiscount.lines)).not.toContain("Discount");

    const withDelivery = buildReceiptDocument(baseOrder({ orderType: "delivery", deliveryFee: 3.5 }), 80);
    expect(allText(withDelivery.lines)).toContain("Delivery fee");
  });

  it("never fabricates an amount-tendered/change line — the order model has no such field", () => {
    const text = allText(buildReceiptDocument(baseOrder(), 80).lines);
    expect(text.toLowerCase()).not.toContain("tendered");
    expect(text.toLowerCase()).not.toContain("change due");
  });

  it("handles a long restaurant name and long item name without throwing, wrapping instead", () => {
    const order = baseOrder({
      restaurantName: "The Absolutely Wonderful Neighborhood Bistro And Grill",
      items: [
        {
          menuItemId: "m1",
          name: "The Deluxe Triple-Stacked Bacon Cheeseburger With Everything On It",
          unitPrice: 25,
          quantity: 1,
          selectedModifiers: [],
          lineTotal: 25,
        },
      ],
    });
    expect(() => buildReceiptDocument(order, 58)).not.toThrow();
    const doc = buildReceiptDocument(order, 58);
    expect(doc.escposBase64.length).toBeGreaterThan(0);
  });

  it("always produces a non-empty escposBase64 alongside the human-readable lines", () => {
    const doc = buildReceiptDocument(baseOrder(), 58);
    expect(doc.lines.length).toBeGreaterThan(0);
    expect(doc.escposBase64.length).toBeGreaterThan(0);
  });
});

describe("buildKitchenTicketDocument", () => {
  it("includes items/modifiers/notes but omits prices and payment information entirely", () => {
    const order = baseOrder({ customerNotes: "ring doorbell twice", customerName: "Jamie", customerPhone: "555-0199" });
    const text = allText(buildKitchenTicketDocument(order, 80).lines);
    expect(text).toContain("KITCHEN TICKET");
    expect(text).toContain("Pepperoni Pizza");
    expect(text).toContain("ring doorbell twice");
    expect(text).toContain("Jamie");
    expect(text).toContain("555-0199");
    expect(text).not.toContain("$14.99");
    expect(text).not.toContain("$16.19");
    expect(text).not.toContain("paid");
    expect(text).not.toContain("Cash");
  });

  it("omits the customer line entirely when neither name nor phone is present", () => {
    const text = allText(buildKitchenTicketDocument(baseOrder(), 80).lines);
    expect(text).not.toContain("undefined");
  });
});

describe("buildTestDocument", () => {
  it("is clearly labeled as a test print, never resembling a real receipt/ticket", () => {
    const doc = buildTestDocument("Front Counter", 80);
    const text = allText(doc.lines);
    expect(text).toContain("TEST PRINT");
    expect(text).toContain("Front Counter");
    expect(text).toContain("80mm");
    expect(doc.escposBase64.length).toBeGreaterThan(0);
  });
});
