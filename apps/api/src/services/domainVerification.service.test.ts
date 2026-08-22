import { describe, expect, it } from "@jest/globals";
import { isSelfClaim, verificationRecordHost, generateVerificationToken } from "./domainVerification.service.js";
import { normalizeHostname, isValidHostname } from "@restaurant/validation";

describe("normalizeHostname / isValidHostname", () => {
  it.each([
    ["HTTPS://Orders.Example.com./", "orders.example.com"],
    ["  orders.example.com  ", "orders.example.com"],
    ["http://orders.example.com", "orders.example.com"],
    ["ORDERS.EXAMPLE.COM", "orders.example.com"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it.each([
    ["https://example.com/path", false, "has a path"],
    ["example.com?query=1", false, "has a query string"],
    ["not a hostname", false, "contains whitespace"],
    ["192.168.1.1", false, "a bare IPv4 address"],
    ["localhost", false, "no dot"],
    ["[::1]", false, "a bracketed IPv6 address"],
    ["orders.example.com", true, "a genuinely valid hostname"],
    ["a.b.c.example.co.uk", true, "a multi-label valid hostname"],
  ])("isValidHostname(%s) === %s (%s)", (input, expected) => {
    expect(isValidHostname(input)).toBe(expected);
  });
});

describe("isSelfClaim", () => {
  it("rejects a hostname that exactly matches the platform's own configured origin", () => {
    expect(isSelfClaim("app.tablecloth.example", "app.tablecloth.example")).toBe(true);
  });

  it("allows any hostname that doesn't match the platform's own origin", () => {
    expect(isSelfClaim("orders.acme-restaurants.com", "app.tablecloth.example")).toBe(false);
  });
});

describe("verificationRecordHost / generateVerificationToken", () => {
  it("builds the expected TXT record host", () => {
    expect(verificationRecordHost("orders.example.com")).toBe("_tablecloth-verify.orders.example.com");
  });

  it("generates an unpredictable, fixed-length hex token each call", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });
});
