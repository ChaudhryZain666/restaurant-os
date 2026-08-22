import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end proof of Phase 10's autocomplete/geocoding layer on top of Phase 9's delivery system:
 * a customer never types raw coordinates during normal checkout — they search, pick a suggestion,
 * and the server resolves it to real coordinates that then flow through the UNCHANGED Phase 9
 * eligibility/fee/snapshot pipeline. Runs against the dev API's GEOCODING_PROVIDER=test adapter
 * (apps/api/.env) — a real, selectable GeocodingService implementation with no network dependency,
 * so this suite never depends on a live third-party geocoding provider being reachable in CI. Its
 * fixture set (services/geocoding/TestGeocodingProvider.ts) intentionally reuses the same
 * Springfield/Chicago/Austin/Boston points Phase 9's delivery.spec.ts already established.
 */

async function registerAndLand(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Geocoding Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2ePassword1!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/r\/demo-restaurant$/, { timeout: 10_000 });
}

/** Handles both cases: an item with no modifier groups adds directly, while one with any
 *  modifier group (even optional) opens a selection panel first — see delivery.spec.ts (Phase 9)
 *  for why this can't just assume "no panel". Never selects an option, so price stays at base. */
async function addItemToCart(page: Page, itemName: string) {
  const row = page.locator("li", { hasText: itemName }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });
  const confirmButton = row.getByRole("button", { name: "Confirm add to cart" });
  if (await confirmButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmButton.click();
  }
}

async function searchAndSelectAddress(page: Page, query: string, suggestionText: string | RegExp) {
  const searchBox = page.getByPlaceholder(/Search for your delivery address/i);
  await searchBox.fill(query);
  const suggestion = page.getByRole("option", { name: suggestionText });
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await suggestion.click();
}

test.describe("geocoding-driven delivery checkout (Phase 10)", () => {
  test.describe.configure({ timeout: 60_000 });

  test("1. full flow: search an address, pick a suggestion, coordinates resolve, eligibility + fee appear, order snapshots the geocoded address", async ({
    page,
  }) => {
    await registerAndLand(page, `e2e-geo-full-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();
    await page.locator("label", { hasText: "Delivery" }).click();

    // Before any address is chosen, the manual-coordinate fields are NOT the primary UI — no
    // "Latitude"/"Longitude" inputs are visible by default (Part 8: "should NOT need to manually
    // type latitude/longitude during normal use").
    await expect(page.getByPlaceholder("Latitude")).not.toBeVisible();

    await searchAndSelectAddress(page, "1200 6th springfield", /Springfield/);

    // Selecting a suggestion fills the structured fields from the resolved result.
    await expect(page.getByPlaceholder("Street address")).toHaveValue(/1200/);
    await expect(page.getByPlaceholder("City")).toHaveValue("Springfield");
    await expect(page.getByText(/Location set — 39\.7658/)).toBeVisible();

    // The server-side eligibility check (unchanged Phase 9 pipeline) then confirms deliverability.
    await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\$3\.99 delivery fee/)).toBeVisible();

    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });

    // OrderDetailPage shows the geocoded, snapshotted delivery info.
    await expect(page.getByText("Delivery fee")).toBeVisible();
    await expect(page.getByText(/1200/)).toBeVisible();
    await expect(page.getByText("Distance")).toBeVisible();
  });

  test("2. an address with no matching results shows a friendly message, not a crash", async ({ page }) => {
    await registerAndLand(page, `e2e-geo-noresults-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();
    await page.locator("label", { hasText: "Delivery" }).click();

    const searchBox = page.getByPlaceholder(/Search for your delivery address/i);
    await searchBox.fill("nowhere on earth xyz");
    await expect(page.getByText("No matching address found.")).toBeVisible({ timeout: 10_000 });
    // The rest of checkout is still usable — this isn't a blocking crash.
    await expect(page.getByRole("button", { name: /Place order/ })).toBeVisible();
  });

  test("3. a simulated provider failure shows a friendly error, never a raw exception", async ({ page }) => {
    await registerAndLand(page, `e2e-geo-providererror-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();
    await page.locator("label", { hasText: "Delivery" }).click();

    // TestGeocodingProvider's documented trigger for a simulated provider_error (see
    // services/geocoding/TestGeocodingProvider.ts) — proves the UI's error path end to end
    // without needing a live provider outage.
    const searchBox = page.getByPlaceholder(/Search for your delivery address/i);
    await searchBox.fill("provider_error_test");
    await expect(page.getByText("Unable to find that address right now. Please try again.")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("4. an address outside the delivery radius is still rejected after resolving through geocoding", async ({ page }) => {
    await registerAndLand(page, `e2e-geo-outside-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();
    await page.locator("label", { hasText: "Delivery" }).click();

    await searchAndSelectAddress(page, "wacker chicago", /Chicago/);

    await expect(page.getByText(/outside the delivery area/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Place order/ })).toBeDisabled();
  });

  test("5. an online-paid delivery order charges the correct server-computed total for a geocoded address", async ({ page }) => {
    await registerAndLand(page, `e2e-geo-payment-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();
    await page.locator("label", { hasText: "Delivery" }).click();
    await searchAndSelectAddress(page, "1200 6th springfield", /Springfield/);
    await page.locator("label", { hasText: "Pay online" }).click();

    await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
    // Caesar Salad $8.50 + $3.99 delivery fee = $12.49 pre-checkout estimate (tax excluded, same
    // as every other order type — see delivery.spec.ts, Phase 9).
    await expect(page.getByRole("button", { name: /Continue to payment — \$12\.49/ })).toBeVisible();

    await page.getByRole("button", { name: /Continue to payment/ }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    // $8.50 subtotal, 8% tax => $0.68, + $3.99 delivery fee => $13.17 real, server-computed total.
    await expect(page.getByText("$13.17", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Pay now" }).click();
    await expect(page.getByRole("button", { name: "Simulate successful payment" })).toBeVisible({ timeout: 10_000 });
  });

  test("6. a promo code still applies correctly to a delivery order placed with a geocoded address", async ({ page, request }) => {
    const ownerLogin = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: { email: "owner@demo-restaurant.local", password: "Owner123!" },
    });
    const { data: loginData } = await ownerLogin.json();
    const ownerToken = loginData.accessToken;
    const restaurantRes = await request.get("http://localhost:4000/api/v1/restaurants/by-slug/demo-restaurant");
    const { data: restaurantData } = await restaurantRes.json();
    const restaurantId = restaurantData.restaurant.id;
    const code = `GEO${Date.now().toString(36).toUpperCase()}`;
    await request.post(`http://localhost:4000/api/v1/restaurants/${restaurantId}/promotions`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { code, name: "Geo test promo", type: "fixed", value: 2 },
    });

    await registerAndLand(page, `e2e-geo-promo-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();

    await page.getByPlaceholder("Enter a code").fill(code);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(new RegExp(code)).first()).toBeVisible({ timeout: 10_000 });

    await page.locator("label", { hasText: "Delivery" }).click();
    await searchAndSelectAddress(page, "1200 6th springfield", /Springfield/);
    await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
    // Subtotal $8.50 - $2 promo = $6.50, + $3.99 delivery fee = $10.49 pre-checkout estimate.
    await expect(page.getByRole("button", { name: /Place order — \$10\.49/ })).toBeVisible();

    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    // $8.50 - $2 = $6.50 taxable, 8% tax => $0.52, + $3.99 fee => $11.01 real total.
    await expect(page.getByText("$11.01", { exact: true })).toBeVisible();
  });

  test("7. cross-restaurant isolation: the same search flow against two different restaurants uses each one's own location/radius", async ({
    page,
  }) => {
    await registerAndLand(page, `e2e-geo-crosstenant-${Date.now()}@test.local`);

    // spice-route is seeded near Austin — searching an Austin address should be eligible there.
    await page.goto("http://localhost:5173/r/spice-route");
    await addItemToCart(page, "Butter Chicken");
    await page.getByRole("link", { name: /Cart/ }).click();
    await expect(page).toHaveURL(/\/r\/spice-route\/cart$/);
    await page.locator("label", { hasText: "Delivery" }).click();
    await searchAndSelectAddress(page, "austin congress", /Austin/);
    await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });

    // The exact same account, same restaurant, searching a Boston address instead (bella-vista's
    // city, nowhere near spice-route's own Austin location) must be rejected.
    await searchAndSelectAddress(page, "boston bella vista", /Boston/);
    await expect(page.getByText(/outside the delivery area/i)).toBeVisible({ timeout: 10_000 });
  });

  test("8. mobile viewport: full search -> select -> order flow renders correctly with no horizontal overflow", async ({
    browser,
  }) => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await mobileContext.newPage();
    try {
      await registerAndLand(page, `e2e-geo-mobile-${Date.now()}@test.local`);
      await page.goto("http://localhost:5173/");
      await addItemToCart(page, "Caesar Salad");
      await page.getByRole("link", { name: /Cart/ }).click();
      await page.locator("label", { hasText: "Delivery" }).click();
      await searchAndSelectAddress(page, "1200 6th springfield", /Springfield/);

      await expect(page.getByText(/Delivery available/)).toBeVisible({ timeout: 10_000 });
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);

      await page.getByRole("button", { name: /Place order/ }).click();
      await expect(page).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    } finally {
      await mobileContext.close();
    }
  });

  test("9. pickup and dine-in checkout never show the delivery address search box (regression)", async ({ page }) => {
    await registerAndLand(page, `e2e-geo-pickupregression-${Date.now()}@test.local`);
    await page.goto("/");
    await addItemToCart(page, "Caesar Salad");
    await page.getByRole("link", { name: /Cart/ }).click();
    // Pickup is the default order type.
    await expect(page.getByPlaceholder(/Search for your delivery address/i)).not.toBeVisible();
  });
});
