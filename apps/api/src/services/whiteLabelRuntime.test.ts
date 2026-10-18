import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Agency } from "../models/Agency.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { Business } from "../models/Business.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { MockDnsRecord } from "../models/MockDnsRecord.js";
import { Order } from "../models/Order.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { getEmailService } from "../email/index.js";
import { orderConfirmationEmail, passwordResetEmail } from "../email/templates.js";
import { dispatchOrderNotification } from "../queues/notification.queue.js";
import { resolveEmailBrandForBusiness } from "./emailBranding.service.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestBusiness,
  createTestOrder,
  createTestPlan,
  createTestRestaurant,
  createTestSubscription,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

/**
 * White-label runtime — the six capabilities end to end: server-side state, public storefront
 * projection, branded sign-in on verified domains only, branded email with the sender lifecycle,
 * and isolation between agencies. Uses the mock DNS verifier (DNS_VERIFIER defaults to mock in tests).
 */
jest.setTimeout(30_000);

const app = createApp();
const run = Date.now();
const agencyDomain = `agency-${run}.example.com`;
const hostname = `orders-${run}.client-test.com`;
const EDGE = "domains.platform-test.example";

let agency: Awaited<ReturnType<typeof createTestAgency>>;
let otherAgency: Awaited<ReturnType<typeof createTestAgency>>;
let business: Awaited<ReturnType<typeof createTestBusiness>>;
let otherBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let otherRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerToken: string;
let otherOwnerToken: string;
let platformAdminToken: string;
let customerId: mongoose.Types.ObjectId;
const userIds: mongoose.Types.ObjectId[] = [];
const planIds: mongoose.Types.ObjectId[] = [];
const originalTarget = env.CUSTOM_DOMAIN_CNAME_TARGET;

const ALL = ["storefront_branding", "custom_domain", "hide_platform_branding", "support_branding", "email_branding", "branded_login"];

async function select(features: string[]) {
  const res = await request(app)
    .put(`/api/v1/agencies/${agency.id}/businesses/${business.id}/white-label`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ enabledFeatures: features });
  expect(res.status).toBe(200);
  return res;
}

async function status() {
  const res = await request(app)
    .get(`/api/v1/agencies/${agency.id}/businesses/${business.id}/white-label`)
    .set("Authorization", `Bearer ${ownerToken}`);
  expect(res.status).toBe(200);
  return Object.fromEntries(
    (res.body.data.status.capabilities as { feature: string; state: string; blockers: string[] }[]).map((c) => [c.feature, c])
  ) as Record<string, { state: string; blockers: string[]; sender?: { status: string; platformSender: boolean } }>;
}

beforeAll(async () => {
  await connectDB();
  agency = await createTestAgency({
    name: "Internal Agency Name",
    brandName: "Northstar Kitchens",
    brandPrimaryColor: "#1D4ED8",
    logo: "https://cdn.example.com/northstar.png",
    whiteLabelEnabled: true,
    whiteLabelOfferings: ALL,
    supportEmail: `help@${agencyDomain}`,
    supportUrl: "https://help.example.com",
    contactEmail: `ops-${run}@internal.example.com`,
  });
  otherAgency = await createTestAgency({ brandName: "Rival Group", whiteLabelEnabled: true, whiteLabelOfferings: ALL });

  const owner = await createTestUser("agency_member");
  const otherOwner = await createTestUser("agency_member");
  const admin = await createTestUser("platform_admin");
  const customer = await createTestUser("customer");
  userIds.push(owner._id, otherOwner._id, admin._id, customer._id);
  customerId = customer._id;
  await createTestAgencyMembership(agency._id, owner._id);
  await createTestAgencyMembership(otherAgency._id, otherOwner._id);
  ownerToken = tokenFor(owner, [{ agencyId: agency.id, role: "agency_owner" }]);
  otherOwnerToken = tokenFor(otherOwner, [{ agencyId: otherAgency.id, role: "agency_owner" }]);
  platformAdminToken = tokenFor(admin);

  business = await createTestBusiness({ agencyId: agency._id });
  otherBusiness = await createTestBusiness({ agencyId: otherAgency._id, whiteLabelFeatures: ALL });
  restaurant = await createTestRestaurant({ businessId: business._id, status: "active", slug: `wl-client-${run}`, email: `kitchen-${run}@example.com` });
  otherRestaurant = await createTestRestaurant({ businessId: otherBusiness._id, status: "active", slug: `wl-other-${run}` });

  const plan = await createTestPlan();
  planIds.push(plan._id);
  await createTestSubscription("business", business._id, plan._id);
});

afterEach(() => {
  jest.restoreAllMocks();
  env.CUSTOM_DOMAIN_CNAME_TARGET = originalTarget;
});

afterAll(async () => {
  const restaurantIds = [restaurant._id, otherRestaurant._id];
  await Promise.all([
    Agency.deleteMany({ _id: { $in: [agency._id, otherAgency._id] } }),
    AgencyAuditLog.deleteMany({ agencyId: { $in: [agency._id, otherAgency._id] } }),
    AgencyMembership.deleteMany({ agencyId: { $in: [agency._id, otherAgency._id] } }),
    Business.deleteMany({ _id: { $in: [business._id, otherBusiness._id] } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    DomainMapping.deleteMany({ locationId: { $in: restaurantIds } }),
    MockDnsRecord.deleteMany({ hostname: { $regex: String(run) } }),
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Subscription.deleteMany({ ownerId: business._id }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("storefront projection — only what's in force, only public fields", () => {
  it("shows no agency branding until a capability is selected", async () => {
    await select([]);
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.whiteLabelBrand).toBeNull();
    expect(res.body.data.supportIdentity).toEqual({ name: "Platform Support", isWhiteLabel: false });
  });

  it("brands the storefront and support, never leaking internal agency data, and never brands sign-in on a slug URL", async () => {
    await select(["storefront_branding", "hide_platform_branding", "support_branding", "branded_login"]);
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(res.body.data.whiteLabelBrand).toEqual({
      name: "Northstar Kitchens",
      logo: "https://cdn.example.com/northstar.png",
      primaryColor: "#1D4ED8",
      hidePlatformBranding: true,
      brandedLogin: false,
      storefrontBranding: true,
    });
    expect(res.body.data.supportIdentity).toEqual({
      name: "Northstar Kitchens",
      isWhiteLabel: true,
      email: `help@${agencyDomain}`,
      url: "https://help.example.com",
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Internal Agency Name");
    expect(body).not.toContain(`ops-${run}`);
    expect(body).not.toContain("whiteLabelOfferings");
  });

  it("one agency's selections never brand another agency's client", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${otherRestaurant.slug}`);
    expect(res.body.data.whiteLabelBrand?.name).not.toBe("Northstar Kitchens");
    expect(res.body.data.supportIdentity.name).not.toBe("Northstar Kitchens");
  });

  it("suspends everything (falls back to the platform) when the agency stops offering it or is suspended", async () => {
    await Agency.updateOne({ _id: agency._id }, { whiteLabelOfferings: ["support_branding"] });
    let res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(res.body.data.whiteLabelBrand).toBeNull();
    expect(res.body.data.supportIdentity.isWhiteLabel).toBe(true);
    const states = await status();
    expect(states.storefront_branding.state).toBe("suspended");
    expect(states.support_branding.state).toBe("active");

    await Agency.updateOne({ _id: agency._id }, { whiteLabelOfferings: ALL, status: "suspended" });
    res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(res.body.data.whiteLabelBrand).toBeNull();
    expect(res.body.data.supportIdentity.isWhiteLabel).toBe(false);
    expect((await status()).support_branding.state).toBe("suspended");
    await Agency.updateOne({ _id: agency._id }, { status: "active" });
  });

  it("refuses non-https logos and support URLs at the API boundary", async () => {
    for (const body of [{ logo: "javascript:alert(1)" }, { logo: "http://cdn.example.com/a.png" }, { supportUrl: "data:text/html,hi" }]) {
      const res = await request(app).patch(`/api/v1/agencies/${agency.id}`).set("Authorization", `Bearer ${ownerToken}`).send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe("custom domain + branded sign-in — active only when the domain is really served", () => {
  it("stays pending while the platform edge isn't configured", async () => {
    env.CUSTOM_DOMAIN_CNAME_TARGET = undefined;
    await select(["custom_domain", "branded_login"]);
    const states = await status();
    expect(states.custom_domain.state).toBe("pending_setup");
    expect(states.custom_domain.blockers[0]).toMatch(/CUSTOM_DOMAIN_CNAME_TARGET/);
    expect(states.branded_login.state).toBe("pending_setup");
  });

  it("walks pending verification → verified → active, and needs DNS to point at the edge", async () => {
    env.CUSTOM_DOMAIN_CNAME_TARGET = EDGE;
    expect((await status()).custom_domain.blockers[0]).toMatch(/Add a domain/);

    const mapping = await DomainMapping.create({ hostname, businessId: business._id, locationId: restaurant._id, verificationToken: "tok" });
    expect((await status()).custom_domain.blockers[0]).toMatch(/publish the TXT record/);

    await DomainMapping.updateOne({ _id: mapping._id }, { status: "verified" });
    expect((await status()).custom_domain.blockers[0]).toMatch(/activate it/);

    await DomainMapping.updateOne({ _id: mapping._id }, { status: "active" });
    let states = await status();
    expect(states.custom_domain.state).toBe("pending_setup");
    expect(states.custom_domain.blockers[0]).toMatch(/CNAME/);

    await MockDnsRecord.create({ hostname, cnameValues: [`${EDGE}.`] });
    states = await status();
    expect(states.custom_domain.state).toBe("active");
    expect(states.branded_login.state).toBe("active");
  });

  it("brands the sign-in screen only when resolved through that verified domain", async () => {
    await select(["custom_domain", "branded_login"]);
    const viaDomain = await request(app).get(`/api/v1/restaurants/by-domain/${hostname}`);
    expect(viaDomain.status).toBe(200);
    expect(viaDomain.body.data.whiteLabelBrand.brandedLogin).toBe(true);
    const viaSlug = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(viaSlug.body.data.whiteLabelBrand?.brandedLogin ?? false).toBe(false);
  });

  it("reports failed when the plan stops including custom domains", async () => {
    env.CUSTOM_DOMAIN_CNAME_TARGET = EDGE;
    await Subscription.updateMany({ ownerId: business._id }, { status: "cancelled" });
    const states = await status();
    expect(states.custom_domain.state).toBe("failed");
    expect(states.branded_login.state).toBe("pending_setup");
    await Subscription.updateMany({ ownerId: business._id }, { status: "active" });
  });
});

describe("branded email and the custom sender lifecycle", () => {
  it("brands order email for the client and links to its live domain; another tenant's email is untouched", async () => {
    env.CUSTOM_DOMAIN_CNAME_TARGET = EDGE;
    await select(["email_branding", "custom_domain"]);
    const send = jest.spyOn(getEmailService(), "send").mockResolvedValue();
    const order = await createTestOrder(restaurant._id, customerId);
    await dispatchOrderNotification("order.created", {
      orderId: order.id,
      restaurantId: restaurant.id,
      customerId: customerId.toString(),
    } as never);

    const toCustomer = send.mock.calls.map((c) => c[0]).find((m) => m.subject.startsWith("Your order"))!;
    expect(toCustomer.from).toEqual({ name: "Northstar Kitchens" }); // platform address, agency name
    expect(toCustomer.text).toContain(`https://${hostname}/orders/${order.id}`);
    expect(toCustomer.html).toContain("Sent by Northstar Kitchens using GarnishTable");

    send.mockClear();
    const otherOrder = await createTestOrder(otherRestaurant._id, customerId);
    await dispatchOrderNotification("order.created", {
      orderId: otherOrder.id,
      restaurantId: otherRestaurant.id,
      customerId: customerId.toString(),
    } as never);
    for (const [message] of send.mock.calls) {
      expect(message.from?.name).not.toBe("Northstar Kitchens");
      expect(message.text).not.toContain(hostname);
    }
  });

  it("never uses a custom sender until the domain is verified AND a platform admin confirms it", async () => {
    let res = await request(app)
      .put(`/api/v1/agencies/${agency.id}/email-sender`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ address: "orders@not-our-domain.com" });
    expect(res.status).toBe(400); // no agency domain yet

    await request(app).post(`/api/v1/agencies/${agency.id}/domain`).set("Authorization", `Bearer ${ownerToken}`).send({ domain: agencyDomain });
    res = await request(app)
      .put(`/api/v1/agencies/${agency.id}/email-sender`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ address: "orders@not-our-domain.com" });
    expect(res.status).toBe(400); // wrong domain

    res = await request(app)
      .put(`/api/v1/agencies/${agency.id}/email-sender`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ address: `orders@${agencyDomain}` });
    expect(res.body.data.agency.emailSender.status).toBe("pending_domain");
    expect((await resolveEmailBrandForBusiness(business._id))!.from.address).toBeUndefined();

    // DNS-verify the agency domain → waits for platform authorization, still not used.
    const fresh = await Agency.findById(agency._id);
    await MockDnsRecord.create({ hostname: `_garnishtable-verify.${agencyDomain}`, txtValues: [fresh!.domainVerificationToken!] });
    await request(app).post(`/api/v1/agencies/${agency.id}/domain/verify`).set("Authorization", `Bearer ${ownerToken}`);
    expect((await Agency.findById(agency._id))!.emailSender!.status).toBe("pending_authorization");
    expect((await status()).email_branding.sender).toMatchObject({ status: "pending_authorization", platformSender: true });
    expect((await resolveEmailBrandForBusiness(business._id))!.from.address).toBeUndefined();

    // Only a platform admin can confirm it.
    const byAgency = await request(app)
      .post(`/api/v1/platform/agencies/${agency.id}/email-sender/review`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ decision: "verified" });
    expect(byAgency.status).toBe(403);
    const byAdmin = await request(app)
      .post(`/api/v1/platform/agencies/${agency.id}/email-sender/review`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ decision: "verified" });
    expect(byAdmin.status).toBe(200);

    const brand = (await resolveEmailBrandForBusiness(business._id))!;
    expect(brand.from).toEqual({ name: "Northstar Kitchens", address: `orders@${agencyDomain}` });
    expect(brand.replyTo).toBe(`help@${agencyDomain}`);
    expect(await AgencyAuditLog.exists({ agencyId: agency._id, action: "agency.email_sender_verified" })).toBeTruthy();
  });

  it("another agency can't claim the verified domain, and moving the domain withdraws the sender", async () => {
    const claim = await request(app)
      .post(`/api/v1/agencies/${otherAgency.id}/domain`)
      .set("Authorization", `Bearer ${otherOwnerToken}`)
      .send({ domain: agencyDomain });
    expect(claim.status).toBe(409);

    await request(app).post(`/api/v1/agencies/${agency.id}/domain`).set("Authorization", `Bearer ${ownerToken}`).send({ domain: `new-${agencyDomain}` });
    expect((await Agency.findById(agency._id))!.emailSender!.status).toBe("pending_domain");
    const brand = (await resolveEmailBrandForBusiness(business._id))!;
    expect(brand.from.address).toBeUndefined();
    expect(brand.replyTo).toBeUndefined();
  });

  it("a member of another agency can't read or change this client's white-label settings", async () => {
    const read = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses/${business.id}/white-label`)
      .set("Authorization", `Bearer ${otherOwnerToken}`);
    expect(read.status).toBe(403);
    const crossBusiness = await request(app)
      .get(`/api/v1/agencies/${otherAgency.id}/businesses/${business.id}/white-label`)
      .set("Authorization", `Bearer ${otherOwnerToken}`);
    expect(crossBusiness.status).toBe(404);
  });
});

describe("email templates", () => {
  it("escapes the brand, hides the platform credit when asked, and leaves unbranded email unchanged", () => {
    const details = { restaurantName: "Cafe", orderNumber: "A1", total: "$1", orderType: "pickup", trackingUrl: "https://x/orders/1" };
    const branded = orderConfirmationEmail("c@example.com", details, {
      name: "<script>x</script>",
      logo: "javascript:alert(1)",
      color: "red;}",
      hidePlatformBranding: true,
      from: { name: "<script>x</script>" },
    });
    expect(branded.html).not.toContain("<script>");
    expect(branded.html).not.toContain("javascript:");
    expect(branded.html).toContain("Sent on behalf of");
    expect(branded.html).not.toContain("GarnishTable");

    const plain = orderConfirmationEmail("c@example.com", details);
    expect(plain.from).toBeUndefined();
    expect(plain.html).toContain("GarnishTable");
  });

  it("keeps security email platform-branded with no tenant sender", () => {
    const reset = passwordResetEmail("c@example.com", "https://order.example.com/reset?token=t");
    expect(reset.from).toBeUndefined();
    expect(reset.replyTo).toBeUndefined();
  });
});

describe("agency-owned domain namespace", () => {
  const nsDomain = `ns-${run}.example.org`;
  let nsAgency: Awaited<ReturnType<typeof createTestAgency>>;
  let nsBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
  let nsRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let foreignRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let nsToken: string;
  let foreignToken: string;

  beforeAll(async () => {
    nsAgency = await createTestAgency({ domain: nsDomain, domainStatus: "verified", whiteLabelEnabled: true, whiteLabelOfferings: ALL });
    nsBusiness = await createTestBusiness({ agencyId: nsAgency._id, whiteLabelFeatures: ["custom_domain", "branded_login"] });
    nsRestaurant = await createTestRestaurant({ businessId: nsBusiness._id, status: "active", slug: `ns-client-${run}` });
    const plan = await createTestPlan();
    planIds.push(plan._id);
    await createTestSubscription("business", nsBusiness._id, plan._id);
    await createTestSubscription("business", otherBusiness._id, plan._id);
    foreignRestaurant = await createTestRestaurant({ businessId: otherBusiness._id, status: "active", slug: `ns-foreign-${run}` });
    const nsOwner = await createTestUser("agency_member");
    userIds.push(nsOwner._id);
    await createTestAgencyMembership(nsAgency._id, nsOwner._id);
    nsToken = tokenFor(nsOwner, [{ agencyId: nsAgency.id, role: "agency_owner" }]);
    foreignToken = otherOwnerToken;
  });

  afterAll(async () => {
    await Promise.all([
      Agency.deleteOne({ _id: nsAgency._id }),
      AgencyMembership.deleteMany({ agencyId: nsAgency._id }),
      Business.deleteOne({ _id: nsBusiness._id }),
      Restaurant.deleteMany({ _id: { $in: [nsRestaurant._id, foreignRestaurant._id] } }),
      DomainMapping.deleteMany({ locationId: { $in: [nsRestaurant._id, foreignRestaurant._id] } }),
      Subscription.deleteMany({ ownerId: { $in: [nsBusiness._id, otherBusiness._id] } }),
    ]);
  });

  it("verifies a client hostname under the agency's verified domain without a per-host TXT record", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${nsRestaurant.id}/domains`)
      .set("Authorization", `Bearer ${nsToken}`)
      .send({ hostname: `shop.${nsDomain}` });
    expect(res.status).toBe(201);
    expect(res.body.data.domain.status).toBe("verified");
  });

  it("refuses a hostname under that domain to another agency's client", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${foreignRestaurant.id}/domains`)
      .set("Authorization", `Bearer ${foreignToken}`)
      .send({ hostname: `other.${nsDomain}` });
    expect(res.status).toBe(409);
  });

  it("never serves a foreign tenant's pre-existing mapping under the agency's domain", async () => {
    await DomainMapping.create({
      hostname: `legacy.${nsDomain}`,
      businessId: otherBusiness._id,
      locationId: foreignRestaurant._id,
      status: "active",
      verificationToken: "t",
    });
    const res = await request(app).get(`/api/v1/restaurants/by-domain/legacy.${nsDomain}`);
    expect(res.status).toBe(404);
  });

  it("serves the agency's own client hostname once activated, with branded sign-in", async () => {
    const mapping = await DomainMapping.findOne({ hostname: `shop.${nsDomain}` });
    const act = await request(app)
      .post(`/api/v1/restaurants/${nsRestaurant.id}/domains/${mapping!.id}/activate`)
      .set("Authorization", `Bearer ${nsToken}`);
    expect(act.status).toBe(200);
    const res = await request(app).get(`/api/v1/restaurants/by-domain/shop.${nsDomain}`);
    expect(res.status).toBe(200);
    expect(res.body.data.whiteLabelBrand.brandedLogin).toBe(true);
  });

  it("stops serving (and branding sign-in) as soon as the domain is deactivated", async () => {
    const mapping = await DomainMapping.findOne({ hostname: `shop.${nsDomain}` });
    await request(app).post(`/api/v1/restaurants/${nsRestaurant.id}/domains/${mapping!.id}/deactivate`).set("Authorization", `Bearer ${nsToken}`);
    const res = await request(app).get(`/api/v1/restaurants/by-domain/shop.${nsDomain}`);
    expect(res.status).toBe(404);
  });
});

describe("sender revocation and template escaping", () => {
  it("a revoked sender falls back to the platform address immediately", async () => {
    // Re-establish a verified sender on a fresh verified domain for the main agency.
    const fresh = `rev-${run}.example.net`;
    await Agency.updateOne(
      { _id: agency._id },
      { domain: fresh, domainStatus: "verified", emailSender: { address: `orders@${fresh}`, status: "pending_authorization", requestedAt: new Date() } }
    );
    await select(["email_branding"]);
    await request(app)
      .post(`/api/v1/platform/agencies/${agency.id}/email-sender/review`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ decision: "verified" });
    expect((await resolveEmailBrandForBusiness(business._id))!.from.address).toBe(`orders@${fresh}`);

    const revoke = await request(app)
      .post(`/api/v1/platform/agencies/${agency.id}/email-sender/review`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ decision: "failed", reason: "Provider no longer authorizes this domain" });
    expect(revoke.status).toBe(200);
    expect((await resolveEmailBrandForBusiness(business._id))!.from.address).toBeUndefined();
    const audit = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.email_sender_rejected" }).sort({ createdAt: -1 });
    expect(audit?.metadata).toMatchObject({ previousStatus: "verified" });
  });

  it("escapes tenant-provided names in every branded template", () => {
    const evil = `<img src=x onerror="alert(1)">`;
    const email = orderConfirmationEmail("c@example.com", {
      restaurantName: evil,
      orderNumber: evil,
      total: "$1",
      orderType: "pickup",
      trackingUrl: "https://x/orders/1",
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x");
  });
});
