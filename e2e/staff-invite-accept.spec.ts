import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 17 fresh-restaurant checklist (section 12, steps 17-20: invite staff -> accept staff
 * invitation -> verify staff permissions) — the owner-invite half of this pipeline was already
 * proven end-to-end by restaurant-provisioning-golden-path.spec.ts, and the resend action by
 * platform-restaurant-detail.spec.ts, but nothing had actually driven a STAFF member all the way
 * from "owner sends invite" through "accepts it and lands in a correctly role-scoped admin" via
 * the real UI. admin-rbac-nav.spec.ts proves the nav-filtering logic itself using a pre-seeded
 * account; this proves the pipeline that gets a real staff account into that state in the first
 * place has no gap a developer would need to paper over.
 *
 * Same documented exception as the golden path: the invite token only ever leaves the server via
 * a real outbound email, so this reads/writes that one field directly against Mongo rather than
 * skipping the step — everything else goes through the real UI.
 */
test.describe.serial("staff invite -> accept -> role-scoped access (Phase 17)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("owner invites a kitchen_staff member, they accept and land in a kitchen-only admin", async ({ browser }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const staffEmail = `e2e-kitchen-staff-${stamp}@test.local`;

    const ownerContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const staffPage = await staffContext.newPage();

    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.locator('input[type="email"]').fill("amara@spice-route.local");
      await ownerPage.locator('input[type="password"]').fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await expect(ownerPage).toHaveURL("http://localhost:5174/", { timeout: 10_000 });

      await ownerPage.getByRole("link", { name: "Staff" }).click();
      await ownerPage.getByRole("button", { name: "Add staff member" }).click();
      await ownerPage.getByLabel("Name").fill("Kitchen Tester");
      await ownerPage.getByLabel("Email").fill(staffEmail);
      await ownerPage.getByLabel("Role").selectOption({ label: "Kitchen staff" });
      await ownerPage.getByRole("button", { name: "Send invite", exact: true }).click();
      await expect(ownerPage.getByText(`Invitation sent to ${staffEmail}`)).toBeVisible({ timeout: 10_000 });

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const usersCollection = db.collection("users");
      const updateResult = await usersCollection.updateOne(
        { email: staffEmail },
        { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
      );
      expect(updateResult.matchedCount).toBe(1);

      await staffPage.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await staffPage.locator('input[type="password"]').fill("KitchenTester123!");
      await staffPage.getByRole("button", { name: "Accept invitation" }).click();

      // kitchen_staff holds no restaurant.analytics.read, so DashboardPage redirects it straight
      // to Kitchen instead of the analytics-driven "/" dashboard (same mechanism restaurant_staff
      // relies on in admin-rbac-nav.spec.ts).
      await expect(staffPage).toHaveURL(/\/kitchen$/, { timeout: 10_000 });

      const nav = staffPage.locator("aside nav");
      await expect(nav.getByRole("link", { name: "Kitchen" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
      // The deliberately narrow kitchen nav must not expose the rest of the restaurant admin
      // surface — kitchen_staff holds none of the permissions those pages need.
      for (const label of ["Menu", "Staff", "Delivery", "Analytics", "Settings", "Promotions", "Loyalty", "Tables", "Customers"]) {
        await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
      }

      // Direct navigation to an owner-only route must not render it either.
      await staffPage.goto("http://localhost:5174/settings");
      await expect(staffPage).toHaveURL(/\/kitchen$/, { timeout: 10_000 });
    } finally {
      await ownerContext.close();
      await staffContext.close();
    }
  });
});
