import { describe, expect, it } from "@jest/globals";
import { roomsForTicketEvent } from "./ticketEvents.js";

describe("roomsForTicketEvent", () => {
  it("routes a non-internal event to the customer, restaurant, and platform-support rooms", () => {
    const rooms = roomsForTicketEvent({
      ticketId: "t1",
      ticketNumber: "TKT-1001",
      createdBy: "user1",
      restaurantId: "restaurant1",
      status: "open",
    });

    expect(rooms).toContain("support:platform");
    expect(rooms).toContain("user:user1");
    expect(rooms).toContain("restaurant:restaurant1");
  });

  it("routes an internal-note event ONLY to the platform-support room — never the customer or restaurant room", () => {
    const rooms = roomsForTicketEvent({
      ticketId: "t1",
      ticketNumber: "TKT-1001",
      createdBy: "user1",
      restaurantId: "restaurant1",
      status: "open",
      isInternalMessage: true,
    });

    expect(rooms).toEqual(["support:platform"]);
    expect(rooms).not.toContain("user:user1");
    expect(rooms).not.toContain("restaurant:restaurant1");
  });

  it("omits the restaurant room when the ticket has no restaurant context", () => {
    const rooms = roomsForTicketEvent({
      ticketId: "t1",
      ticketNumber: "TKT-1001",
      createdBy: "user1",
      status: "open",
    });

    expect(rooms).toEqual(["support:platform", "user:user1"]);
  });
});
