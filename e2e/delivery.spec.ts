import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end proof of the Phase 9 delivery system: radius-based eligibility computed server-side
 * (delivery.service.ts), a live checkout preview backed by the same logic createOrder enforces,
 * and a structured address/distance snapshot on the resulting order. Reuses the seeded
 * demo-restaurant (Springfield, IL — 39.7817, -89.6501 — 8km radius, $3.99 delivery fee) and the
 * seeded spice-route/bella-vista restaurants for the cross-tenant check, same reuse pattern as
 * storefront.spec.ts / multi-tenant.spec.ts / online-payment.spec.ts.
 */

// Well within demo-restaurant's 8km radius (~1.8km away — matches Jordan Lee's seeded address).
const NEARBY = { line1: "1200 S 6th St", city: "Springfield", lat: "39.7658", lng: "-89.6501" };
// Chicago, IL — real coordinates, ~320km from demo-restaurant, well outside any sane radius.
const FAR_AWAY = { line1: "233 S Wacker Dr", city: "Chicago", lat: "41.8781", lng: "-87.6298" };

async function registerAndLand(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Delivery Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2ePassword1!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });
}

/**
 * Handles both cases: an item with no modifier groups adds directly on the first click, while an
 * item with any modifier group (even an optional one, like Caesar Salad's "Add protein") opens a
 * selection panel first. Never selects an option, so the item is added at its base price — this
 * is what keeps the exact-total assertions in this spec (e.g. test 5) deterministic.
 */
async function addItemToCart(page: Page, itemName: string) {
  const row = page.locator("li", { hasText: itemName }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });
  const confirmButton = row.getByRole("button", { name: "Confirm add to cart" });
  if (await confirmButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmButton.click();
  }
}

async function goToCartAndSelectDelivery(page: Page) {
  await page.getByRole("link", { name: /Cart/ }).click();
  await page.locator("label", { hasText: "Delivery" }).click();
}

/**
 * Fills the delivery address via the MANUAL coordinate fallback specifically (this spec is about
 * the Phase 9 eligibility system itself, not the Phase 10 autocomplete UI — see
 * geocoding-delivery.spec.ts for that). Phase 10 moved the raw lat/lng inputs behind an "Enter
 * coordinates manually instead" toggle (collapsed by default, autocomplete is now the primary
 * path) — this opens that toggle once if it isn't already open, then fills every field.
 */
async function fillDeliveryAddress(page: Page, addr: { line1: string; city: string; lat: string; lng: string }) {
  await page.getByPlaceholder("Street address").fill(addr.line1);
  await page.getByPlaceholder("City").fill(addr.city);
  if (!(await page.getByPlaceholder("Latitude").isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Enter coordinates manually instead" }).click();
  }
  await page.getByPlaceholder("Latitude").fill(addr.lat);
  await page.getByPlaceholder("Longitude").fill(addr.lng);
}

test.describe("delivery (Phase 9)", () => {
  test.describe.configure({ timeout: 60_000 });

  test("1. full setup-to-order flow: admin's configured delivery area is what the customer actually checks out against", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    try {
      // --- Admin side: confirm the delivery area the owner configured is what's live ---
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.locator('input[type="email"]').fill("owner@demo-restaurant.local");
      await ownerPage.locator('input[type="password"]').fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await ownerPage.getByRole("link", { name: "Delivery" }).click();
      await expect(ownerPage.getByRole("heading", { name: "Delivery area" })).toBeVisible();
      await expect(ownerPage.getByLabel(/delivery radius/i)).toHaveValue("8");
    } finally {
      await ownerContext.close();
    }

    // --- Customer side: places a real delivery order for an address inside that radius ---
    const customerContext = await browser.newContext();
    const page = await customerContext.newPage();
    try {
      await registerAndLand(page, `e2e-delivery-full-${Date.now()}@test.local`);
      await page.goto("http://localhost:5173/");
      await addItemToCart(page, "Caesar Salad");
      await goToCartAndSelectDelivery(page);
      await fillDeliveryAddress(page, NEARBY);

      await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/\$3\.99 delivery fee/)).toBeVisible();
      await expect(page.getByText(/km away/)).toBeVisible();

      await page.getByRole("button", { name: /Place order/ }).click();
      await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

      await expect(page.getByText("Delivery fee")).toBeVisible();
      await expect(page.getByText("$3.99")).toBeVisible();
      await expect(page.getByText("Distance")).toBeVisible();
      await expect(page.getByText(/km$/)).toBeVisible();
      await expect(page.getByText(/1200 S 6th St/)).toBeVisible();
    } finally {
      await customerContext.close();
    }
  });

  test("2. an address outside the delivery radius is clearly rejected and blocks checkout", async ({ page }) => {
    await registerAndLand(page, `e2e-delivery-outside-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await goToCartAndSelectDelivery(page);
    await fillDeliveryAddress(page, FAR_AWAY);

    await expect(page.getByText(/outside the delivery area/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Place order/ })).toBeDisabled();
  });

  test("3. pickup ordering is unaffected by the delivery eligibility system (regression)", async ({ page }) => {
    await registerAndLand(page, `e2e-delivery-pickup-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();

    // Pickup is the default order type — no delivery address fields, no delivery fee.
    await expect(page.getByPlaceholder("Street address")).not.toBeVisible();
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(page.getByText("Pickup", { exact: true })).toBeVisible();
    await expect(page.getByText("Delivery address")).not.toBeVisible();
  });

  test("4. dine-in ordering via a table QR code is unaffected by the delivery eligibility system (regression)", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const tableName = `E2E Delivery Regression Table ${Date.now()}`;

    try {
      await ownerPage.goto("http://localhost:5174/login");
      await ownerPage.locator('input[type="email"]').fill("owner@demo-restaurant.local");
      await ownerPage.locator('input[type="password"]').fill("Owner123!");
      await ownerPage.getByRole("button", { name: "Sign in" }).click();
      await ownerPage.getByRole("link", { name: "Tables" }).click();
      await ownerPage.getByRole("button", { name: "New table" }).click();
      await ownerPage.getByLabel("Name").fill(tableName);
      await ownerPage.getByRole("button", { name: "Create table" }).click();

      const tableRow = ownerPage.locator("li", { hasText: tableName });
      await tableRow.getByRole("button", { name: "QR code" }).click();
      const urlText = ownerPage.locator("p", { hasText: "/t/" });
      await expect(urlText).toBeVisible({ timeout: 10_000 });
      const token = (await urlText.innerText()).trim().split("/t/")[1];

      const customerPage = await ownerContext.newPage();
      await customerPage.goto(`http://localhost:5173/r/demo-restaurant/t/${token}`);
      await expect(customerPage.getByText(`Ordering for ${tableName}`)).toBeVisible();

      await addItemToCart(customerPage, "Caesar Salad");
      await customerPage.getByRole("link", { name: /Cart/ }).click();
      await expect(customerPage.getByText(`Served at ${tableName}`)).toBeVisible();
      // Dine-in never shows delivery fields or charges a delivery fee, same as before Phase 9.
      await expect(customerPage.getByPlaceholder("Street address")).not.toBeVisible();

      await customerPage.getByRole("button", { name: /Place order/ }).click();
      await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      await expect(customerPage.getByText("Dine-in", { exact: true })).toBeVisible();
      await expect(customerPage.getByText(tableName).first()).toBeVisible();
      await customerPage.close();
    } finally {
      await ownerContext.close();
    }
  });

  test("5. an online-paid delivery order charges exactly subtotal + tax + delivery fee shown at checkout", async ({
    page,
  }) => {
    await registerAndLand(page, `e2e-delivery-payment-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await goToCartAndSelectDelivery(page);
    await fillDeliveryAddress(page, NEARBY);
    // The radio input is visually hidden — its enclosing label is the real clickable surface.
    await page.locator("label", { hasText: "Pay online" }).click();

    await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
    // Caesar Salad $8.50 + $3.99 delivery fee = $12.49 shown pre-checkout — tax is calculated at
    // checkout for every order type (unchanged from before Phase 9), so it isn't in this figure.
    await expect(page.getByRole("button", { name: /Continue to payment — \$12\.49/ })).toBeVisible();

    await page.getByRole("button", { name: /Continue to payment/ }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    // $8.50 subtotal, 8% tax => $0.68, + $3.99 delivery fee => $13.17 — the real, server-computed
    // total from createOrder, now including the tax the pre-checkout estimate deliberately omitted.
    await expect(page.getByText("$13.17", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Pay now" }).click();
    await expect(page.getByRole("button", { name: "Simulate successful payment" })).toBeVisible({ timeout: 10_000 });
  });

  test("6. a delivery order against one restaurant cannot use a location/radius belonging to a different restaurant", async ({
    page,
  }) => {
    // spice-route (Austin, TX) has a 6km radius around its own coordinates. Attempting a delivery
    // order there using an address near bella-vista's Boston location (~2700km away) must be
    // rejected — proving spice-route's own stored coordinates/radius are what's actually checked,
    // not some shared or attacker-influenced value.
    await registerAndLand(page, `e2e-delivery-crosstenant-${Date.now()}@test.local`);
    await page.goto("http://localhost:5173/r/spice-route");
    await addItemToCart(page, "Butter Chicken");
    await page.getByRole("link", { name: /Cart/ }).click();
    await expect(page).toHaveURL(/\/r\/spice-route\/cart$/);

    await page.locator("label", { hasText: "Delivery" }).click();
    await fillDeliveryAddress(page, { line1: "1 Bella Vista Way", city: "Boston", lat: "42.3601", lng: "-71.0589" });

    await expect(page.getByText(/outside the delivery area/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Place order/ })).toBeDisabled();

    // The same customer CAN order delivery from spice-route to an address actually near it.
    await fillDeliveryAddress(page, { line1: "200 Congress Ave", city: "Austin", lat: "30.2700", lng: "-97.7500" });
    await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
  });

  test("7. mobile viewport: full delivery order flow renders correctly with no horizontal overflow", async ({
    browser,
  }) => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await mobileContext.newPage();
    try {
      await registerAndLand(page, `e2e-delivery-mobile-${Date.now()}@test.local`);
      await page.goto("http://localhost:5173/");
      await addItemToCart(page, "Caesar Salad");
      await goToCartAndSelectDelivery(page);
      await fillDeliveryAddress(page, NEARBY);

      await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);

      await page.getByRole("button", { name: /Place order/ }).click();
      await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await expect(page.getByText("Delivery fee")).toBeVisible();
    } finally {
      await mobileContext.close();
    }
  });
});
