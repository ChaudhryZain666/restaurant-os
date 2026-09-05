import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 19 — proves staff location-scoping holds even against a client-side tampering attempt,
 * not just "the switcher UI doesn't offer the other location." A staff member scoped to only
 * Location A who directly edits their browser's localStorage to claim Location B is active must
 * still end up looking at Location A's data after a reload — both because
 * GET /businesses/:businessId/locations (Phase 19's listBusinessLocations fix) never returns B to
 * them in the first place, and because LocationContext's own resolution logic falls back to a
 * valid location whenever the stored preference isn't in the accessible list. Server-side
 * authorization (requireTenantMatch) is the real boundary either way — this test is about the
 * client not even being ABLE to present a misleading "you're on B" state.
 */
test.describe.serial("multi-location staff isolation (Phase 19)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("a staff member scoped to only Location A cannot be tricked into viewing Location B via tampered localStorage", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const slugA = `e2e-staffiso-a-${stamp}`;
    const restaurantName = `E2E Staff Isolation ${stamp}`;
    const ownerEmail = `e2e-staffiso-owner-${stamp}@test.local`;
    const locationBName = `Staff Isolation B ${stamp}`;
    const slugB = `e2e-staffiso-b-${stamp}`;
    const staffEmail = `e2e-staffiso-staff-${stamp}@test.local`;

    // --- Provision restaurant A and its owner. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slugA);
    await page.getByLabel("Full name").fill("Staff Isolation Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const ownerToken = randomBytes(32).toString("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: createHash("sha256").update(ownerToken).digest("hex"), inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
    );
    await page.goto(`http://localhost:5174/accept-invite?token=${ownerToken}`);
    await page.locator('input[type="password"]').fill("StaffIsoOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    // Portal UX phase: lands on Dashboard's in-place "get ready" state, not a /setup redirect.
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Owner creates Location B. ---
    await page.getByRole("link", { name: "Locations" }).click();
    await page.getByRole("button", { name: "+ Add another location" }).click();
    await page.getByLabel("Name", { exact: true }).fill(locationBName);
    await page.getByLabel("Slug").fill(slugB);
    await page.getByRole("button", { name: "Create location" }).click();
    await expect(page.getByText(`${locationBName} was created`, { exact: false })).toBeVisible({ timeout: 10_000 });

    // --- Owner invites a staff member while Location A is still active — scoped to A only. ---
    await page.getByRole("link", { name: "Staff" }).click();
    await page.getByRole("button", { name: "Add staff member" }).click();
    await page.getByLabel("Name").fill("Staff Isolation Tester");
    await page.getByLabel("Email").fill(staffEmail);
    await page.getByRole("button", { name: "Send invite", exact: true }).click();
    await expect(page.getByText(`Invitation sent to ${staffEmail}`)).toBeVisible({ timeout: 10_000 });

    const staffUser = await db.collection("users").findOne({ email: staffEmail });
    expect(staffUser).not.toBeNull();
    const businessId = staffUser!.businessId.toString();

    // --- Staff accepts their invite and logs in. ---
    const staffToken = randomBytes(32).toString("hex");
    await db.collection("users").updateOne(
      { email: staffEmail },
      { $set: { inviteTokenHash: createHash("sha256").update(staffToken).digest("hex"), inviteExpiresAt: new Date(Date.now() + 3_600_000) } }
    );
    const staffContext = await page.context().browser()!.newContext();
    const staffPage = await staffContext.newPage();
    try {
      await staffPage.goto(`http://localhost:5174/accept-invite?token=${staffToken}`);
      await staffPage.locator('input[type="password"]').fill("StaffIsoStaff123!");
      await staffPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(staffPage).toHaveURL(/\/orders$/, { timeout: 10_000 });

      // Only ever authorized for one location — the switcher must not even appear.
      await expect(staffPage.getByRole("combobox", { name: "Active location" })).toHaveCount(0);

      // --- Tamper: directly set localStorage to claim Location B is active, then reload. ---
      const restaurantB = await db.collection("restaurants").findOne({ slug: slugB });
      expect(restaurantB).not.toBeNull();
      await staffPage.evaluate(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: `activeLocationId:${businessId}`, value: restaurantB!._id.toString() }
      );
      await staffPage.reload();

      // Still no switcher (still only one accessible location), and still landing on Orders —
      // the tampered value was never in GET /businesses/:businessId/locations' response for this
      // staff member (Phase 19's listBusinessLocations fix), so LocationContext's own resolution
      // silently falls back to their real, authorized location instead of trusting localStorage.
      await expect(staffPage).toHaveURL(/\/orders$/, { timeout: 10_000 });
      await expect(staffPage.getByRole("combobox", { name: "Active location" })).toHaveCount(0);

      // Belt-and-suspenders: even if the client somehow displayed B, the server would still 403
      // any real request for it — proven independently at the API level in
      // business.controller.test.ts's "requireTenantMatch's businessId fallback..." suite.
    } finally {
      await staffContext.close();
    }
  });
});
