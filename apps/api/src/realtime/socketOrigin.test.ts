import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connectClient } from "socket.io-client";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestSubscription,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";
import { createSocketServer } from "./socket.js";
import { clearRealtimeOriginCache } from "./realtimeOrigins.js";

/**
 * Phase 86 — Socket.IO handshake origin enforcement. CORS only binds browsers' polling requests;
 * a WebSocket handshake is never subject to CORS, so the server itself refuses handshakes whose
 * Origin names a page we don't serve (allowRequest in socket.ts).
 */
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const liveHost = `live-${stamp}.p86-socket.example`;
const deactivatedHost = `off-${stamp}.p86-socket.example`;

let server: Server;
let url: string;
let token: string;
const cleanup: { business?: string; restaurant?: string; plan?: string; user?: string } = {};

beforeAll(async () => {
  await connectDB();
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id, ownerId: business.ownerId, status: "active" });
  const plan = await createTestPlan({ code: `p86-socket-${stamp}`, entitlements: [{ key: "custom_domains", value: true }] });
  await createTestSubscription("business", business._id, plan._id);
  const common = { businessId: business._id, locationId: restaurant._id, verificationToken: "t", verifiedAt: new Date() };
  await DomainMapping.create({ ...common, hostname: liveHost, status: "active" });
  const other = await createTestRestaurant({ businessId: business._id, ownerId: business.ownerId, status: "active" });
  await DomainMapping.create({ ...common, locationId: other._id, hostname: deactivatedHost, status: "verified" });
  const user = await createTestUser("customer");
  token = tokenFor(user);
  Object.assign(cleanup, { business: business.id, restaurant: restaurant.id, plan: plan.id, user: user.id });
  cleanup.restaurant = restaurant.id;
  (cleanup as Record<string, string>).other = other.id;

  server = createServer();
  createSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  clearRealtimeOriginCache();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([
    DomainMapping.deleteMany({ hostname: { $in: [liveHost, deactivatedHost] } }),
    Subscription.deleteMany({ ownerId: cleanup.business }),
    Restaurant.deleteMany({ _id: { $in: [cleanup.restaurant, (cleanup as Record<string, string>).other] } }),
    Business.deleteOne({ _id: cleanup.business }),
    Plan.deleteOne({ _id: cleanup.plan }),
    User.deleteOne({ _id: cleanup.user }),
  ]);
  await closeTestConnections();
});

function attempt(origin: string | undefined, transport: "polling" | "websocket"): Promise<"connected" | string> {
  return new Promise((resolve) => {
    const socket = connectClient(url, {
      transports: [transport],
      auth: { token },
      reconnection: false,
      timeout: 5000,
      extraHeaders: origin ? { Origin: origin } : {},
    });
    socket.on("connect", () => {
      socket.disconnect();
      resolve("connected");
    });
    socket.on("connect_error", (err) => {
      socket.disconnect();
      resolve(`rejected: ${err.message}`);
    });
  });
}

describe("Socket.IO handshake origin enforcement (Phase 86)", () => {
  for (const transport of ["polling", "websocket"] as const) {
    describe(`${transport} transport`, () => {
      it("accepts GarnishTable's own storefront origin", async () => {
        expect(await attempt(env.CLIENT_ORIGIN, transport)).toBe("connected");
      });

      it("accepts a live restaurant custom domain over https", async () => {
        expect(await attempt(`https://${liveHost}`, transport)).toBe("connected");
      });

      it("rejects an unknown origin", async () => {
        expect(await attempt("https://evil.example", transport)).toMatch(/^rejected/);
      });

      it("rejects a mapped but deactivated custom domain", async () => {
        expect(await attempt(`https://${deactivatedHost}`, transport)).toMatch(/^rejected/);
      });

      it("rejects the plain-http variant of a live custom domain", async () => {
        expect(await attempt(`http://${liveHost}`, transport)).toMatch(/^rejected/);
      });

      it("still accepts a non-browser client with no Origin (authenticated by token)", async () => {
        expect(await attempt(undefined, transport)).toBe("connected");
      });
    });
  }
});
