import { test, expect } from "@playwright/test";

/**
 * End-to-end proof of the full ordering loop through Phase 3:
 *   category created (admin) -> menu item created (admin) -> customer orders it (storefront)
 *   -> restaurant sees the order (admin) -> status progresses pending -> confirmed -> preparing
 *   -> ready -> completed (admin) -> customer's tracking page reflects each step -> customer
 *   reorders the same order from current menu data.
 *
 * Reuses the seeded demo-restaurant/owner rather than creating a fresh restaurant via the
 * platform_admin API: the storefront (apps/web) points at one hardcoded restaurant slug by
 * design in this phase (see docs/roadmap.md — multi-restaurant storefront routing is future
 * work), so a dynamically-created restaurant wouldn't be reachable from the customer side
 * anyway. This still exercises every step of the requested flow end to end.
 *
 * Uses two separate browser contexts (owner, customer) rather than one shared page: admin
 * (localhost:5174) and web (localhost:5173) are different ports of the same "localhost" host,
 * and browser cookies are scoped by host, not port — sharing one page would let the customer's
 * login silently overwrite the owner's refresh-token cookie. Two contexts mirror what's actually
 * true in production too: the restaurant owner and the customer are different people on
 * different browsers.
 */
test("category -> menu item -> customer order -> restaurant status lifecycle -> tracking -> reorder", async ({
  browser,
}) => {
  const itemName = `E2E Burger ${Date.now()}`;
  const categoryName = `E2E Category ${Date.now()}`;

  const ownerContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    // --- Restaurant owner creates a category and a menu item via the real admin UI ---
    await ownerPage.goto("http://localhost:5174/login");
    await ownerPage.getByLabel("Email").fill("owner@demo-restaurant.local");
    await ownerPage.getByLabel("Password").fill("Owner123!");
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.getByRole("link", { name: "Menu" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();

    await ownerPage.getByPlaceholder("New category name").fill(categoryName);
    await ownerPage.getByRole("button", { name: "Add category" }).click();
    await expect(ownerPage.locator("li", { hasText: categoryName })).toBeVisible();

    // --- Unified create-item-then-configure-modifiers workflow (one continuous panel, not two
    // separate trips) — creating the item transitions the same panel straight into modifier
    // configuration for the item that was just created. ---
    await ownerPage.getByRole("button", { name: "+ Add menu item" }).click();
    await ownerPage.getByPlaceholder("Name", { exact: true }).fill(itemName);
    await ownerPage.getByPlaceholder("Base price").fill("9");
    await ownerPage.getByRole("combobox").selectOption({ label: categoryName });
    await ownerPage.getByRole("button", { name: "Create item & continue" }).click();
    await expect(ownerPage.getByText("Sizes & add-ons (modifier groups)")).toBeVisible();
    // Scoped to the modifier-groups panel specifically — the "Basic information" section above it
    // also has a numeric $ input (base price) with the same type/step, so an unscoped page-wide
    // locator for "the number input" would silently hit the wrong field.
    const modifierSection = ownerPage.locator("div", { hasText: "Sizes & add-ons (modifier groups)" }).last();

    // Configure a required "Size" modifier group with a priced option, in the same panel.
    await modifierSection.getByPlaceholder("e.g. Size, Toppings").fill("Size");
    await modifierSection.getByLabel("Min select").fill("1");
    await modifierSection.getByLabel("Max select").fill("1");
    await modifierSection.getByRole("button", { name: "Add modifier group" }).click();
    await expect(modifierSection.getByText("Required")).toBeVisible();

    await modifierSection.getByPlaceholder("Option name").fill("Large");
    await modifierSection.locator('input[type="number"][step="0.01"]').first().fill("1");
    await modifierSection.getByRole("button", { name: "+ Add option" }).click();
    await modifierSection.getByPlaceholder("Option name").nth(1).fill("Regular");
    await modifierSection.getByRole("button", { name: "Save options" }).click();
    // Option names live in controlled <input value=...> fields, not text nodes — assert via
    // toHaveValue, and wait for the post-save reload to repopulate them from the server.
    await expect(modifierSection.getByPlaceholder("Option name").first()).toHaveValue("Large", { timeout: 10_000 });
    await expect(modifierSection.getByPlaceholder("Option name").nth(1)).toHaveValue("Regular");

    await modifierSection.getByRole("button", { name: "Done" }).click();

    // --- Customer places an order for that item via the real storefront UI ---
    await customerPage.goto("http://localhost:5173/login");
    await customerPage.getByLabel("Email").fill("customer1@test.local");
    await customerPage.getByLabel("Password").fill("Customer123!");
    const loginRes = customerPage.waitForResponse((r) => r.url().includes("/api/v1/auth/login"));
    await customerPage.getByRole("button", { name: "Log in" }).click();
    const loginStatus = (await loginRes).status();
    if (loginStatus !== 200) {
      // First run on a fresh DB — this account doesn't exist yet, register it instead.
      await customerPage.goto("http://localhost:5173/register");
      await customerPage.getByLabel("Name").fill("E2E Full Flow Customer");
      await customerPage.getByLabel("Email").fill("customer1@test.local");
      await customerPage.getByLabel("Password").fill("Customer123!");
      await customerPage.getByRole("button", { name: "Create account" }).click();
    }
    // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
    await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/);

    await customerPage.goto("http://localhost:5173/");
    await expect(customerPage.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    const itemRow = customerPage.locator("li", { hasText: itemName });
    await itemRow.scrollIntoViewIfNeeded();
    await itemRow.getByRole("button", { name: "Add to cart" }).click({ timeout: 15_000 });

    // This item has a required "Size" modifier group, so "Add to cart" expands an in-place
    // selector rather than adding directly — this is the real proof that the unified Part 2
    // create-item-and-configure-modifiers workflow produces a genuinely working modifier, not
    // just one that looks configured in the admin UI.
    await expect(itemRow.getByText("Size", { exact: false })).toBeVisible();
    await itemRow.getByText("Large", { exact: false }).click();
    await itemRow.getByRole("button", { name: "Confirm add to cart" }).click();

    await customerPage.getByRole("link", { name: /Cart/ }).click();
    await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible();
    // Server-priced modifier surfaces correctly in the cart, and the total reflects base ($9) +
    // the selected option's price adjustment ($1) — proving pricing stayed server-authoritative
    // through the whole unified creation workflow, not just recorded and ignored.
    await expect(customerPage.getByText("Large (+$1.00)")).toBeVisible();
    await expect(customerPage.getByRole("button", { name: "Place order — $10.00" })).toBeVisible();
    await customerPage.getByRole("button", { name: "Place order" }).click();
    // Phase 3: placing an order lands the customer on that order's own tracking page.
    await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(customerPage.getByText("Order placed successfully!")).toBeVisible();
    const heading = await customerPage.getByRole("heading", { level: 1 }).innerText();
    const orderNumber = heading.match(/ORD-\d+/)![0];

    // --- Restaurant staff sees the order and progresses it through the full status lifecycle ---
    // Client-side nav (not page.goto, a full reload) — a full reload remounts AuthProvider, whose
    // mount effect calls POST /auth/refresh. Under React StrictMode (dev only) that effect double-
    // fires, and the API's refresh token is single-use: two near-simultaneous refresh calls racing
    // on the same not-yet-rotated cookie can revoke the session, intermittently bouncing this page
    // back to /login under parallel test load. Clicking in-app nav/links avoids the reload (and
    // thus the race) entirely on both the owner and customer sides throughout this test.
    await ownerPage.getByRole("link", { name: "Orders" }).click();
    const orderGroup = ownerPage.getByRole("group", { name: `Order ${orderNumber}` });
    await expect(orderGroup).toBeVisible();

    await orderGroup.getByRole("button", { name: "Accept" }).click();
    await expect(orderGroup.getByRole("button", { name: "Start preparing" })).toBeVisible();
    await orderGroup.getByRole("button", { name: "Start preparing" }).click();
    await expect(orderGroup.getByRole("button", { name: "Mark ready" })).toBeVisible();
    await orderGroup.getByRole("button", { name: "Mark ready" }).click();
    await expect(orderGroup.getByRole("button", { name: "Complete" })).toBeVisible();

    // --- Customer's tracking page reflects the "ready" status without a full page reload ---
    await customerPage.getByRole("link", { name: "Orders" }).click();
    await customerPage.getByRole("link", { name: orderNumber }).click();
    await expect(customerPage.getByText("Ready", { exact: true }).first()).toBeVisible();

    // --- Restaurant completes the order ---
    await orderGroup.getByRole("button", { name: "Complete" }).click();
    await expect(orderGroup.getByRole("button")).toHaveCount(0, { timeout: 10_000 });

    // --- Customer sees the completed order ---
    await customerPage.getByRole("link", { name: "Orders" }).click();
    await customerPage.getByRole("link", { name: orderNumber }).click();
    await expect(customerPage.getByText("Completed", { exact: true }).first()).toBeVisible();

    // --- Customer reorders it using current menu data ---
    await customerPage.getByRole("button", { name: "Order again" }).click();
    // Reorder routes to the historical order's OWN restaurant's /r/:slug/cart (Phase 8) — not the
    // legacy bare /cart.
    await expect(customerPage).toHaveURL(/\/r\/demo-restaurant\/cart$/, { timeout: 10_000 });
    await expect(customerPage.getByText(itemName, { exact: false })).toBeVisible();
    await customerPage.getByRole("button", { name: "Place order" }).click();
    await expect(customerPage).toHaveURL(/\/orders\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(customerPage.getByText("Order placed successfully!")).toBeVisible();

    // Clean up the category/item this run created — the demo-restaurant is shared with other
    // e2e specs (see storefront.spec.ts), and leaving them behind would keep growing the
    // dataset and shift "first item" assumptions in other tests on every local run.
    await ownerPage.getByRole("link", { name: "Menu" }).click();
    const itemLi = ownerPage.locator("li", { hasText: itemName });
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await itemLi.getByRole("button", { name: "Delete" }).click();
    await expect(itemLi).toHaveCount(0);
    const categoryLi = ownerPage.locator("li", { hasText: categoryName });
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await categoryLi.getByRole("button", { name: "Delete" }).click();
    await expect(categoryLi).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await customerContext.close();
  }
});
