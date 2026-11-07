import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * The full platform-admin onboarding journey, with no public checkout anywhere:
 *
 *   platform admin creates a restaurant -> gives it a complimentary Owner Growth plan -> extends it
 *   -> owner accepts the invite -> sees a GarnishTable-managed plan with no self-serve billing
 *   actions -> builds a menu and publishes -> a customer orders -> the kitchen completes it ->
 *   the admin suspends and restores the plan.
 *
 * Same one documented exception as restaurant-provisioning-golden-path.spec.ts: the invite token
 * only leaves the server by email, so this test writes a known token hash directly (MONGO_URI must
 * be the database the dev API uses). Everything else is the real UI. Needs the dev API running
 * with BILLING_PROVIDER=mock — nothing here reaches a billing provider either way.
 */
test.describe.serial("platform admin onboarding with a complimentary subscription", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    db = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("admin creates a restaurant and its plan -> owner runs it -> customer order completes", async ({ browser }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const slug = `e2e-onboard-${stamp}`;
    const restaurantName = `E2E Onboarding ${stamp}`;
    const ownerEmail = `e2e-onboard-owner-${stamp}@test.local`;
    const itemName = `Onboarding Bowl ${stamp}`;
    const categoryName = `Bowls ${stamp}`;
    const customerEmail = `e2e-onboard-customer-${stamp}@test.local`;

    const adminContext = await browser.newContext();
    const ownerContext = await browser.newContext();
    const customerContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const ownerPage = await ownerContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      // --- Platform admin creates the restaurant. ---
      await adminPage.goto("http://localhost:5174/login");
      await adminPage.locator('input[type="email"]').fill("platform-admin@restaurant.local");
      await adminPage.locator('input[type="password"]').fill("Admin123!");
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await expect(adminPage).toHaveURL(/\/platform$/, { timeout: 10_000 });

      await adminPage.getByRole("link", { name: "Restaurants" }).click();
      await adminPage.getByRole("button", { name: "Create restaurant" }).click();
      await adminPage.getByLabel("Name", { exact: true }).fill(restaurantName);
      await adminPage.getByLabel("Slug").fill(slug);
      await adminPage.getByLabel("Full name").fill("Onboarding Owner");
      await adminPage.getByLabel("Email", { exact: true }).fill(ownerEmail);
      await adminPage.getByRole("button", { name: "Create restaurant & send invite" }).click();
      await expect(adminPage.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

      // --- ...and gives it a complimentary Owner Growth plan for a year. ---
      await adminPage.getByRole("button", { name: "Back to Restaurants" }).click();
      await adminPage.getByRole("link", { name: restaurantName }).click();
      const planCard = adminPage.getByRole("region", { name: "Plan & billing" });
      await expect(planCard.getByText("No plan yet.")).toBeVisible({ timeout: 10_000 });
      await planCard.getByRole("button", { name: "Set up a plan" }).click();
      await planCard.getByLabel("Complimentary").check();
      await planCard.getByLabel("Plan").selectOption({ label: "Owner — Growth — $99.00/mo" });
      const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await planCard.getByLabel("Ends").fill(oneYear);
      await planCard.getByLabel(/Admin note/).fill("Launch partner, 12 months");
      await planCard.getByRole("button", { name: "Create subscription" }).click();

      await expect(planCard.getByText("Complimentary Owner — Growth subscription created.")).toBeVisible({ timeout: 10_000 });
      await expect(planCard.getByText("Complimentary", { exact: true })).toBeVisible(); // billing-source badge
      await expect(planCard.getByText("Free (complimentary)")).toBeVisible();
      await expect(planCard.getByText("Launch partner, 12 months")).toBeVisible();

      // Extend it by another month.
      await planCard.getByRole("button", { name: "Extend" }).click();
      await planCard.getByRole("button", { name: "Extend" }).click();
      await expect(planCard.getByText(/^Extended to /)).toBeVisible({ timeout: 10_000 });
      await planCard.getByText(/Billing history/).click();
      await expect(planCard.getByText("End date extended", { exact: false })).toBeVisible();
      await expect(planCard.getByText("Payment received")).toHaveCount(0); // nothing was ever paid

      // No billing provider record exists for it.
      const business = await db.collection("businesses").findOne({ slug });
      const sub = await db.collection("subscriptions").findOne({ ownerId: business!._id });
      expect(sub).toMatchObject({ provider: "manual", status: "active", manualBilling: { kind: "complimentary", amountCents: 0 } });
      expect(sub!.providerSubscriptionId).toBeUndefined();

      // --- Owner accepts the invite (token written directly — see the file comment). ---
      const rawToken = randomBytes(32).toString("hex");
      await db
        .collection("users")
        .updateOne(
          { email: ownerEmail },
          { $set: { inviteTokenHash: createHash("sha256").update(rawToken).digest("hex"), inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
        );
      await ownerPage.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
      await ownerPage.locator('input[type="password"]').fill("OnboardOwner123!");
      await ownerPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(ownerPage).toHaveURL(/\/$/, { timeout: 10_000 });
      await expect(ownerPage.getByText("Welcome to your restaurant")).toBeVisible();

      // The owner sees a plan GarnishTable manages — no checkout, card, change or cancel.
      await ownerPage.goto("http://localhost:5174/billing");
      await expect(ownerPage.getByText("Complimentary · provided by GarnishTable")).toBeVisible({ timeout: 10_000 });
      await expect(ownerPage.getByText(/managed by GarnishTable/)).toBeVisible();
      await expect(ownerPage.getByRole("button", { name: "Cancel subscription" })).toHaveCount(0);
      await expect(ownerPage.getByRole("button", { name: /Subscribe|Update payment method/ })).toHaveCount(0);
      await expect(ownerPage.getByText("Launch partner")).toHaveCount(0); // admin note stays admin-side

      // --- Owner builds a menu and publishes. ---
      await ownerPage.getByRole("link", { name: "Menu", exact: true }).click();
      await ownerPage.getByPlaceholder("New category name").fill(categoryName);
      await ownerPage.getByRole("button", { name: "Add category" }).click();
      await expect(ownerPage.locator("li", { hasText: categoryName })).toBeVisible();
      await ownerPage.getByRole("button", { name: "+ Add menu item" }).click();
      await ownerPage.getByPlaceholder("Name", { exact: true }).fill(itemName);
      await ownerPage.getByPlaceholder("Base price").fill("14");
      await ownerPage.getByRole("combobox").selectOption({ label: categoryName });
      await ownerPage.getByRole("button", { name: "Create item & continue" }).click();
      await expect(ownerPage.getByText("Customize this item")).toBeVisible();
      await ownerPage.getByRole("button", { name: "Back to menu" }).click();
      await ownerPage.getByRole("link", { name: "Setup" }).click();
      await expect(ownerPage.getByRole("button", { name: "Publish restaurant" })).toBeEnabled({ timeout: 10_000 });
      await ownerPage.getByRole("button", { name: "Publish restaurant" }).click();
      await expect(ownerPage.getByText("Published")).toBeVisible({ timeout: 10_000 });

      // --- A customer orders. ---
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("Onboarding Customer");
      await customerPage.getByLabel("Email").fill(customerEmail);
      await customerPage.getByLabel("Password").fill("OnboardCustomer1!");
      const registerRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/register"));
      await customerPage.getByRole("button", { name: "Create account" }).click();
      expect((await registerRes).status()).toBe(201);
      await customerPage.goto(`http://localhost:5173/r/${slug}`);
      await expect(customerPage.getByRole("heading", { name: restaurantName })).toBeVisible({ timeout: 10_000 });
      await customerPage.locator("li", { hasText: itemName }).getByRole("button", { name: "Add to cart" }).click();
      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await customerPage.getByRole("button", { name: "Place order" }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      const orderNumber = (await customerPage.getByRole("heading", { level: 1 }).innerText()).match(/ORD-\d+/)![0];

      // --- The restaurant receives and completes it. ---
      await ownerPage.getByRole("link", { name: "Kitchen" }).click();
      const card = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
      await expect(card).toBeVisible({ timeout: 10_000 });
      for (const step of ["Accept", "Start preparing", "Mark ready", "Complete"]) {
        await card.getByRole("button", { name: step }).click();
      }
      await expect(card).toHaveCount(0, { timeout: 10_000 });
      await customerPage.reload();
      await expect(customerPage.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

      // --- Admin suspends the plan (the owner is told), then restores it. ---
      await planCard.getByRole("button", { name: "Suspend" }).click();
      await planCard.getByLabel(/Reason/).fill("Agreement under review");
      await planCard.getByRole("button", { name: "Suspend" }).click();
      await expect(planCard.getByText("Subscription suspended.")).toBeVisible({ timeout: 10_000 });
      await expect(planCard.getByText("Suspended", { exact: true })).toBeVisible();

      await ownerPage.goto("http://localhost:5174/billing");
      await expect(ownerPage.getByText(/paused by GarnishTable: Agreement under review/)).toBeVisible({ timeout: 10_000 });

      await planCard.getByRole("button", { name: "Unsuspend" }).click();
      await expect(planCard.getByText("Subscription unsuspended.")).toBeVisible({ timeout: 10_000 });

      // Every admin action is on the restaurant's audit trail.
      const actions = (await db.collection("auditlogs").find({ targetId: sub!._id }).toArray()).map((a) => a.action).sort();
      expect(actions).toEqual(["subscription.created", "subscription.extended", "subscription.suspended", "subscription.unsuspended"]);
    } finally {
      await adminContext.close();
      await ownerContext.close();
      await customerContext.close();
    }
  });
});
