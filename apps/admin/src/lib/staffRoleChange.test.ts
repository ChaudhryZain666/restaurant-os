import { describe, expect, it } from "@jest/globals";
import { roleChangeConfirmation } from "./staffRoleChange";

// NEW-3 — a role change is confirmed before it saves.
describe("staff role change confirmation (NEW-3)", () => {
  it("names the person, the current and the proposed role, and explains the permission change", () => {
    const c = roleChangeConfirmation("Jamie Park", "kitchen_staff", "restaurant_manager");
    expect(c).toEqual({
      title: "Change Jamie Park's role to Manager?",
      from: "Kitchen staff",
      to: "Manager",
      effect: "Their permissions change as soon as you confirm. As Manager: Full operational access — menu, orders, analytics, tickets.",
    });
  });

  it("choosing the role they already have needs no confirmation and saves nothing", () => {
    expect(roleChangeConfirmation("Jamie Park", "kitchen_staff", "kitchen_staff")).toBeNull();
  });
});
