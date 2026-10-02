import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { httpCorsOrigins, realtimeOrigins } from "../config/origins.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import { clearRealtimeOriginCache, createRealtimeOriginCheck, isActiveCustomDomainOrigin } from "./realtimeOrigins.js";

const PRODUCTION_ORIGINS = {
  CLIENT_ORIGIN: "https://order.garnishtable.com",
  ADMIN_ORIGIN: "https://app.garnishtable.com",
  MARKETING_ORIGIN: "https://garnishtable.com",
  PORTAL_ORIGINS: ["https://agency.garnishtable.com", "https://admin.garnishtable.com", "https://pos.garnishtable.com"],
};

describe("origin allow-lists (Phase 85A)", () => {
  it("HTTP CORS covers every GarnishTable surface, including all four admin-app portals", () => {
    expect(httpCorsOrigins(PRODUCTION_ORIGINS).sort()).toEqual(
      [
        "https://admin.garnishtable.com",
        "https://agency.garnishtable.com",
        "https://app.garnishtable.com",
        "https://garnishtable.com",
        "https://order.garnishtable.com",
        "https://pos.garnishtable.com",
      ].sort()
    );
  });

  it("Socket.IO covers the storefront and every portal (POS/kitchen realtime) but not marketing", () => {
    const origins = realtimeOrigins(PRODUCTION_ORIGINS);
    expect(origins).toContain("https://pos.garnishtable.com");
    expect(origins).toContain("https://order.garnishtable.com");
    expect(origins).not.toContain("https://garnishtable.com");
  });
});

function check(origin: string | undefined, isCustom: (o: string) => Promise<boolean> = async () => false) {
  return new Promise<boolean | undefined>((resolve, reject) => {
    createRealtimeOriginCheck(realtimeOrigins(PRODUCTION_ORIGINS), isCustom)(origin, (err, allow) => (err ? reject(err) : resolve(allow)));
  });
}

describe("createRealtimeOriginCheck", () => {
  it("allows configured origins and requests without an Origin header", async () => {
    expect(await check("https://pos.garnishtable.com")).toBe(true);
    expect(await check(undefined)).toBe(true);
  });

  it("allows an unknown origin only when it is an active custom domain", async () => {
    expect(await check("https://orders.somerestaurant.com", async () => true)).toBe(true);
    expect(await check("https://evil.example", async () => false)).toBe(false);
  });

  it("fails closed when the custom-domain lookup errors", async () => {
    expect(await check("https://orders.somerestaurant.com", async () => Promise.reject(new Error("db down")))).toBe(false);
  });
});

describe("isActiveCustomDomainOrigin", () => {
  const hostname = `orders-${Date.now()}.realtime-test.example`;

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(() => {
    clearRealtimeOriginCache();
  });

  afterAll(async () => {
    await DomainMapping.deleteMany({ hostname: { $in: [hostname, `pending-${hostname}`] } });
    await closeTestConnections();
  });

  it("accepts an https origin whose hostname is an ACTIVE custom domain, and nothing else", async () => {
    const ids = { businessId: new mongoose.Types.ObjectId(), verificationToken: "t" };
    await DomainMapping.create({ ...ids, locationId: new mongoose.Types.ObjectId(), hostname, status: "active" });
    await DomainMapping.create({ ...ids, locationId: new mongoose.Types.ObjectId(), hostname: `pending-${hostname}`, status: "verified" });

    expect(await isActiveCustomDomainOrigin(`https://${hostname}`)).toBe(true);
    expect(await isActiveCustomDomainOrigin(`https://pending-${hostname}`)).toBe(false);
    expect(await isActiveCustomDomainOrigin(`http://${hostname}`)).toBe(false);
    expect(await isActiveCustomDomainOrigin(`https://${hostname}/path`)).toBe(false);
    expect(await isActiveCustomDomainOrigin("not a url")).toBe(false);
  });
});
