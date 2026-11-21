import { describe, expect, it } from "@jest/globals";
import { pageMetaFor } from "./pageTitles";

describe("storefront page titles (QA-013)", () => {
  it("names each page after what it is, with the restaurant", () => {
    expect(pageMetaFor("/r/demo-restaurant/cart", "Wildwood Kitchen")?.title).toBe("Cart · Wildwood Kitchen");
    expect(pageMetaFor("/cart", "Wildwood Kitchen")?.title).toBe("Cart · Wildwood Kitchen");
    expect(pageMetaFor("/login", null)?.title).toBe("Sign in");
    expect(pageMetaFor("/orders", "GarnishTable")?.title).toBe("My orders · GarnishTable");
    expect(pageMetaFor("/orders/6650a1/receipt", null)?.title).toBe("Receipt");
    expect(pageMetaFor("/support/tickets/new", null)?.title).toBe("Contact support");
    expect(pageMetaFor("/support/tickets/abc", null)?.title).toBe("Support request");
  });

  it("every titled page has a description", () => {
    for (const path of ["/cart", "/login", "/register", "/orders", "/orders/x", "/account", "/support", "/support/articles/a", "/loyalty"]) {
      expect(pageMetaFor(path, null)?.description.length).toBeGreaterThan(10);
    }
  });

  it("leaves pages that title themselves alone", () => {
    expect(pageMetaFor("/r/demo-restaurant", "Wildwood Kitchen")).toBeNull();
    expect(pageMetaFor("/", null)).toBeNull();
    expect(pageMetaFor("/no-such-page", null)).toBeNull();
  });
});
