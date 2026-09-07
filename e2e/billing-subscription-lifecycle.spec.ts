import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { test, expect } from "@playwright/test";

/**
 * Originally Phase 24: an owner started a no-card trial and drove a real, signature-verified
 * mock-advance event to convert it to active before testing cancel/reactivate. Phase 34 then
 * deliberately closed off provider-contact for the no-card-trial path entirely (verified against a
 * real Paddle sandbox: "you can't create a subscription directly" — see subscription.service.ts's
 * createSubscriptionCore doc comment) specifically so it never gets a providerSubscriptionId until
 * checkout — which means the mock-advance dev button (billingMockDriver.controller.ts's
 * mockAdvanceSubscription, gated on providerSubscriptionId existing) can no longer convert one,
 * by design. Phase 54 found the stale half of this test (still trying that now-impossible
 * conversion) and reconciled it: this now reaches "active" the same real way the Phase 27 spec
 * below does — a genuine mock-checkout completion, which DOES attach a provider reference — so the
 * cancel-schedule/reactivate lifecycle below (the actual remaining point of this spec, and still not
 * covered by the Phase 27 spec) continues to exercise a REAL provider-backed subscription rather
 * than silently degrading into a no-op.
 *
 * Same documented exception as the other golden-path specs for the owner invite token (only ever
 * leaves the server via a real outbound email, so it's read/written directly against Mongo here).
 */
test.describe.serial("owner subscription cancel/reactivate lifecycle (Phase 24, reconciled Phase 54)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("start -> active (via real mock-checkout) -> cancelling -> active again", async ({ page }) => {
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

    // --- Reach "active" through a real mock-checkout completion (the only path that attaches a
    // provider reference for a mock-provider subscription — see this file's header comment). ---
    await page.getByRole("button", { name: "Subscribe now" }).click();
    await expect(page).toHaveURL(/\/mock-checkout\//, { timeout: 10_000 });
    await page.getByRole("button", { name: "Confirm mock payment" }).click();
    await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Back to billing" }).click();
    await expect(page).toHaveURL(/\/billing$/, { timeout: 10_000 });
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

    // --- Phase 39: the real, founder-approved Starter/Growth catalog pricing renders in the plan
    // picker (superseding Phase 34's Basic/Pro tiers, and the original single "owner" $79.00 plan
    // before that — both retained inactive, never deleted or price-mutated — see
    // docs/commercial-decisions.md §Phase 39). Both current tiers are real, selectable options; this
    // test proceeds on whichever the picker defaults to (BillingPage.tsx seeds it from the first
    // OWNER-type plan). ---
    await expect(page.locator("option", { hasText: "$59.00" })).toHaveCount(1);
    await expect(page.locator("option", { hasText: "$99.00" })).toHaveCount(1);

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
 * Originally Phase 34, reconciled in Phase 54 to the real founder-approved catalog (Phase 39 —
 * docs/commercial-decisions.md) after the Basic/Pro tiers it exercised were superseded and retired
 * (isActive:false, never deleted — see planCatalogSeed.service.ts). Proves the Starter/Growth tier
 * picker and the change-plan action work against the real active catalog, and that a Starter
 * subscriber's UI reflects Starter's own lower included-location count (not a shared, untiered
 * number) — the "Owner Starter" and "Owner Growth" commercial journeys.
 */
test.describe.serial("owner Starter/Growth tier selection and upgrade (Phase 39 catalog)", () => {
  let db: mongoose.Connection;

  test.beforeAll(async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_URI ?? "mongodb://localhost:27017/restaurant_platform").asPromise();
    db = conn;
  });

  test.afterAll(async () => {
    await db.close();
  });

  test("starts on Starter (1 included location), upgrades to Growth, sees Growth's higher included-location count", async ({ page }) => {
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

    // --- Explicitly select Starter (plan code "owner_starter") rather than relying on whichever
    // the picker defaults to, then start the no-card trial. ---
    await page.getByLabel("Plan").selectOption({ value: "owner_starter" });
    const includedLocationsRow = page.locator("dt", { hasText: "Included locations" }).locator("xpath=following-sibling::dd");
    await expect(includedLocationsRow).toHaveText("1");
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page.getByText("Starter", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Trial", { exact: true })).toBeVisible();

    // --- Change plan to Growth (plan code "owner_growth") — a real changeSubscriptionPlan call,
    // not a re-subscribe. Portal UX safety phase: selecting a plan now opens a confirmation dialog
    // (current plan/new plan/price/scope, and a location-limit conflict check) instead of
    // mutating immediately — confirming it is what actually calls change-plan. ---
    await page.getByLabel("Change plan:").selectOption({ value: "owner_growth" });
    await expect(page.getByRole("heading", { name: "Change your plan?" })).toBeVisible();
    // Growth's own higher included-location count (2, vs. Starter's 1) is visible right in the
    // confirmation dialog before it's ever confirmed — this is what actually proves the tier
    // change carries a real entitlement difference, not just a renamed label.
    const dialogIncludedLocations = page
      .getByRole("alertdialog")
      .locator("dt", { hasText: "Included locations" })
      .locator("xpath=following-sibling::dd");
    await expect(dialogIncludedLocations).toHaveText("2");
    await page.getByRole("button", { name: "Change plan" }).click();
    // Wait for the dialog to actually close (the change-plan request + reload landing) before
    // checking the plan name elsewhere on the page — otherwise this can transiently race the
    // dialog's own "New plan" line, which shows the same text.
    await expect(page.getByRole("heading", { name: "Change your plan?" })).toHaveCount(0);
    await expect(page.getByText("Growth", { exact: false })).toBeVisible({ timeout: 10_000 });
  });
});
