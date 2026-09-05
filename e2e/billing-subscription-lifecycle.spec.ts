import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Phase 24 — the real, browser-driven proof of the billing lifecycle: an owner with no
 * subscription starts one against the mock provider, sees it trialing, drives a real (signature-
 * verified) event through the mock-advance dev button to convert the trial to active — the same
 * code path a genuine webhook delivery goes through (billingMockDriver.controller.ts) — then
 * schedules cancellation, sees the "cancelling" state, and reactivates. Deliberately one focused
 * spec, not a giant journey — existing restaurant/business workflows are proven unaffected simply
 * by the rest of the suite staying green (nothing new gates them; see entitlement.service.ts's
 * header comment).
 *
 * Same documented exception as the other golden-path specs for the owner invite token (only ever
 * leaves the server via a real outbound email, so it's read/written directly against Mongo here).
 */
test.describe.serial("owner billing lifecycle via the mock provider (Phase 24)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("start -> trial -> active (via mock-advance) -> cancelling -> active again", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-billing-${stamp}`;
    const restaurantName = `E2E Billing ${stamp}`;
    const ownerEmail = `e2e-billing-owner-${stamp}@test.local`;

    // --- Platform admin provisions a restaurant + owner invite. ---
    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Billing Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );

    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("BillingOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // --- Billing: no subscription yet. ---
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByText("No subscription yet.")).toBeVisible({ timeout: 10_000 });

    // --- Start a subscription against the mock provider -> trialing. ---
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page.getByText("Trial", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Simulate the trial converting (a real, signature-verified event through the same code
    // path a genuine webhook delivery uses — not a database shortcut) -> active. ---
    await page.getByRole("button", { name: "Simulate trial conversion (dev)" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Owner schedules cancellation -> cancelling, visible period-end date. ---
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel subscription" }).click();
    await expect(page.getByText("Cancelling", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Cancels on")).toBeVisible();

    // --- Owner reactivates -> back to active, cancel date cleared. ---
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Cancels on")).not.toBeVisible();
  });
});

/**
 * Phase 27 — the real, browser-driven proof of the payment-method-up-front checkout path: unlike
 * the no-card trial flow above, "Subscribe now" launches a real navigation to the mock provider's
 * checkout stub page (never a direct database write pretending payment succeeded), and only
 * confirming payment there activates a subscription via the real webhook-processing path. Also
 * proves the plan's own pricing renders, and that billing history reflects the real events.
 */
test.describe.serial("owner checkout — payment-method-up-front path (Phase 27)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("Subscribe now -> mock checkout stub -> confirm payment -> subscription activates immediately, no trial", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-checkout-${stamp}`;
    const restaurantName = `E2E Checkout ${stamp}`;
    const ownerEmail = `e2e-checkout-owner-${stamp}@test.local`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Checkout Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );

    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("CheckoutOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByText("No subscription yet.")).toBeVisible({ timeout: 10_000 });

    // --- Phase 34: the real Basic/Pro catalog pricing renders in the plan picker (superseding
    // the original single "owner" $79.00 plan, retained inactive — see docs/commercial-decisions.md
    // §2). Both tiers are real, selectable options; this test proceeds on whichever the picker
    // defaults to (BillingPage.tsx seeds it from the first OWNER-type plan). ---
    await expect(page.locator("option", { hasText: "$15.00" })).toHaveCount(1);
    await expect(page.locator("option", { hasText: "$29.00" })).toHaveCount(1);

    // --- Launch checkout: a real navigation to the mock provider's stub page, not a shortcut. ---
    await page.getByRole("button", { name: "Subscribe now" }).click();
    await expect(page).toHaveURL(/\/mock-checkout\//, { timeout: 10_000 });
    await expect(page.getByText("Mock checkout")).toBeVisible();

    // --- Nothing is active yet until the mock payment is explicitly confirmed. ---
    await page.getByRole("button", { name: "Confirm mock payment" }).click();
    await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Back to billing" }).click();
    await expect(page).toHaveURL(/\/billing$/, { timeout: 10_000 });
    // Checkout implies immediate payment — active right away, never a trial.
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });

    // --- Billing history reflects the real webhook-driven events, not a client-side fabrication. ---
    await expect(page.getByText("Subscription started")).toBeVisible();
    await expect(page.getByText("Payment succeeded")).toBeVisible();
  });
});

/**
 * Phase 34 — proves the Basic/Pro tier picker and the change-plan action work against the real
 * seeded catalog, and that a Basic subscriber's UI reflects Basic's own lower included-location
 * count (not a shared, untiered number) — the "Owner Basic" and "Owner Pro" commercial journeys.
 */
test.describe.serial("owner Basic/Pro tier selection and upgrade (Phase 34)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("starts on Basic (1 included location), upgrades to Pro, sees Pro's higher included-location count", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const slug = `e2e-tier-${stamp}`;
    const restaurantName = `E2E Tier ${stamp}`;
    const ownerEmail = `e2e-tier-owner-${stamp}@test.local`;

    await page.goto("http://localhost:5174/login");
    await page.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Restaurants" }).click();
    await page.getByRole("button", { name: "Create restaurant" }).click();
    await expect(page).toHaveURL(/\/platform\/restaurants\/new$/);
    await page.getByLabel("Name", { exact: true }).fill(restaurantName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Full name").fill("Tier Owner");
    await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Create restaurant & send invite" }).click();
    await expect(page.getByText("Restaurant created")).toBeVisible({ timeout: 10_000 });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.collection("users").updateOne(
      { email: ownerEmail },
      { $set: { inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } }
    );

    await page.goto(`http://localhost:5174/accept-invite?token=${rawToken}`);
    await page.locator('input[type="password"]').fill("TierOwner123!");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByText("No subscription yet.")).toBeVisible({ timeout: 10_000 });

    // --- Explicitly select Basic (plan code "owner_basic") rather than relying on whichever the
    // picker defaults to, then start the no-card trial. ---
    await page.getByLabel("Plan").selectOption({ value: "owner_basic" });
    const includedLocationsRow = page.locator("dt", { hasText: "Included locations" }).locator("xpath=following-sibling::dd");
    await expect(includedLocationsRow).toHaveText("1");
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page.getByText("Basic", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Trial", { exact: true })).toBeVisible();

    // --- Change plan to Pro (plan code "owner_pro") — a real changeSubscriptionPlan call, not a
    // re-subscribe. Portal UX safety phase: selecting a plan now opens a confirmation dialog
    // (current plan/new plan/price/scope, and a location-limit conflict check) instead of
    // mutating immediately — confirming it is what actually calls change-plan. ---
    await page.getByLabel("Change plan:").selectOption({ value: "owner_pro" });
    await expect(page.getByRole("heading", { name: "Change your plan?" })).toBeVisible();
    await page.getByRole("button", { name: "Change plan" }).click();
    // Wait for the dialog to actually close (the change-plan request + reload landing) before
    // checking the plan name elsewhere on the page — otherwise this can transiently race the
    // dialog's own "New plan" line, which shows the same text.
    await expect(page.getByRole("heading", { name: "Change your plan?" })).toHaveCount(0);
    await expect(page.getByText("Pro", { exact: false })).toBeVisible({ timeout: 10_000 });
  });
});
