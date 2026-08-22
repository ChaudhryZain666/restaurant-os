import { test, expect } from "@playwright/test";

/**
 * End-to-end proof of the Phase 4 support loop:
 *   platform admin publishes a knowledge-base article (admin) -> customer finds it via search
 *   and the help widget (storefront) -> customer creates a ticket -> platform admin sees it,
 *   adds an internal note AND a customer-visible reply, and marks it resolved (admin) ->
 *   customer sees the reply but never the internal note, and confirms resolution (storefront).
 *
 * Two browser contexts for the same reason as full-order-flow.spec.ts: admin (:5174) and web
 * (:5173) are different ports of the same host, and cookies are host-scoped, not port-scoped —
 * sharing one page would let one login silently clobber the other's session.
 */
test("knowledge base publish -> customer search/ticket -> support reply with private internal note -> resolution", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const articleTitle = `E2E Help Article ${Date.now()}`;
  const articleKeyword = `zzzhelpkeyword${Date.now()}`;

  const adminContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    // --- Platform admin publishes a knowledge-base article ---
    await adminPage.goto("http://localhost:5174/login");
    await adminPage.locator('input[type="email"]').fill("platform-admin@restaurant.local");
    await adminPage.locator('input[type="password"]').fill("Admin123!");
    await adminPage.getByRole("button", { name: "Sign in" }).click();
    await adminPage.getByRole("link", { name: "Support" }).first().click();
    await adminPage.getByRole("link", { name: "Knowledge base" }).click();
    await expect(adminPage.getByRole("heading", { name: "Knowledge base" })).toBeVisible();

    const categoryInput = adminPage.getByPlaceholder("New category name");
    const categoryName = `E2E Category ${Date.now()}`;
    await categoryInput.fill(categoryName);
    await adminPage.getByRole("button", { name: "Add category" }).click();
    await expect(adminPage.getByRole("listitem").filter({ hasText: categoryName })).toBeVisible();

    await adminPage.getByRole("combobox").first().selectOption({ label: categoryName });
    await adminPage.getByPlaceholder("Title").fill(articleTitle);
    await adminPage.getByPlaceholder("Summary (shown in search results)").fill(`Summary for ${articleKeyword}`);
    await adminPage.getByPlaceholder("Article content").fill(`This article explains ${articleKeyword} in detail.`);
    await adminPage.locator("select").nth(1).selectOption("published");
    await adminPage.getByRole("button", { name: "Create article" }).click();
    await expect(adminPage.getByText(articleTitle)).toBeVisible();

    // --- Customer registers, finds the article via search, and opens the help widget ---
    const email = `e2e-support-${Date.now()}@test.local`;
    await customerPage.goto("http://localhost:5173/register");
    await customerPage.getByLabel("Name").fill("E2E Support Customer");
    await customerPage.getByLabel("Email").fill(email);
    await customerPage.getByLabel("Password").fill("E2ePassword1!");
    await customerPage.getByRole("button", { name: "Create account" }).click();
    // "/" legacy-redirects to the default restaurant's canonical /r/:slug URL (Phase 8).
    await expect(customerPage).toHaveURL(/\/r\/demo-restaurant$/);

    // Client-side nav throughout (not page.goto, a full reload) — same StrictMode/refresh-token
    // race documented in full-order-flow.spec.ts: a full reload remounts AuthProvider, whose
    // mount effect double-fires under dev-only React StrictMode and can race the single-use
    // refresh token cookie. Only the very first navigation (before any session exists) uses goto.
    await customerPage.getByRole("link", { name: "Support", exact: true }).click();
    await expect(customerPage.getByRole("heading", { name: "Platform Support" })).toBeVisible();

    await customerPage.getByPlaceholder("Search for help...").fill(articleKeyword);
    await customerPage.getByRole("button", { name: "Search" }).click();
    await expect(customerPage.getByText(articleTitle)).toBeVisible({ timeout: 10_000 });
    await customerPage.getByText(articleTitle).click();
    await expect(customerPage.getByRole("heading", { name: articleTitle })).toBeVisible();
    await expect(customerPage.getByText(articleKeyword, { exact: false }).first()).toBeVisible();

    // --- The help widget itself opens and is usable ---
    await customerPage.getByRole("link", { name: "Menu" }).click();
    await customerPage.getByRole("button", { name: "Open help widget" }).click();
    await expect(customerPage.getByRole("heading", { name: "Platform Support" })).toBeVisible();
    await customerPage.getByRole("button", { name: "Close help widget" }).click();

    // --- Customer creates a ticket ---
    await customerPage.getByRole("link", { name: "Support", exact: true }).click();
    await customerPage.getByRole("button", { name: "Contact Platform Support" }).click();
    await expect(customerPage).toHaveURL("http://localhost:5173/support/tickets/new");
    await customerPage.getByPlaceholder("Briefly summarize your issue").fill("My order is missing an item");
    await customerPage
      .getByPlaceholder("What happened, and what were you trying to do?")
      .fill("I ordered two items but only received one.");
    await customerPage.getByRole("button", { name: "Submit ticket" }).click();
    await expect(customerPage).toHaveURL(/\/support\/tickets\/[a-f0-9]+$/, { timeout: 10_000 });
    await expect(customerPage.getByText("My order is missing an item")).toBeVisible();
    await expect(customerPage.getByText("Open")).toBeVisible();
    const ticketNumber = (await customerPage.getByText(/^TKT-\d+$/).innerText()).trim();

    // --- Customer replies ---
    await customerPage.getByPlaceholder("Write a reply...").fill("Any update on this?");
    await customerPage.getByRole("button", { name: "Send reply" }).click();
    await expect(customerPage.getByText("Any update on this?")).toBeVisible();

    // --- Platform admin sees the ticket, adds an internal note AND a customer-visible reply, resolves it ---
    await adminPage.getByRole("link", { name: "Support" }).first().click();
    const adminTicketRow = adminPage.locator("tr", { hasText: ticketNumber });
    await expect(adminTicketRow).toBeVisible({ timeout: 10_000 });
    await adminTicketRow.getByRole("link", { name: "My order is missing an item" }).click();
    await expect(adminPage).toHaveURL(/\/platform\/support\/tickets\//);

    const noteBox = adminPage.getByPlaceholder("Write a reply or internal note...");
    const internalCheckbox = adminPage.getByLabel("Internal note (never visible to the customer)");
    await noteBox.fill("Internal: refund approved, do not mention the warehouse mixup to the customer.");
    await internalCheckbox.check();
    await adminPage.getByRole("button", { name: "Add note" }).click();
    await expect(adminPage.getByText("Internal note").first()).toBeVisible();
    // Wait for the post-send state reset (setReply/setIsInternal, then reload) to fully settle
    // before typing the next message — filling mid-reconciliation can otherwise get clobbered.
    await expect(noteBox).toHaveValue("");
    await expect(internalCheckbox).not.toBeChecked();

    await noteBox.fill("We've found the issue and are sending the missing item right away.");
    await expect(noteBox).toHaveValue("We've found the issue and are sending the missing item right away.");
    await adminPage.getByRole("button", { name: "Send reply" }).click();
    await expect(adminPage.getByText("We've found the issue and are sending the missing item right away.")).toBeVisible();

    await adminPage.locator("select").first().selectOption("resolved");
    await expect(adminPage.locator("select").first()).toHaveValue("resolved");

    // --- Customer sees the reply, sees the resolved state, but NEVER the internal note ---
    await customerPage.getByRole("link", { name: "Support", exact: true }).click();
    await customerPage.getByRole("link", { name: "My tickets" }).click();
    await customerPage.getByText("My order is missing an item").click();
    await expect(customerPage).toHaveURL(/\/support\/tickets\/[a-f0-9]+$/);

    await expect(customerPage.getByText("We've found the issue and are sending the missing item right away.")).toBeVisible();
    await expect(customerPage.getByText("refund approved", { exact: false })).toHaveCount(0);
    await expect(customerPage.getByText("warehouse mixup", { exact: false })).toHaveCount(0);
    await expect(customerPage.getByText("Was your issue fixed?")).toBeVisible();

    await customerPage.getByRole("button", { name: "Yes, close this ticket" }).click();
    await expect(customerPage.getByText("This ticket is closed.")).toBeVisible();
  } finally {
    await adminContext.close();
    await customerContext.close();
  }
});
