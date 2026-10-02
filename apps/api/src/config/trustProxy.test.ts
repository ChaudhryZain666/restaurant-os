import { describe, expect, it } from "@jest/globals";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { createApp } from "../app.js";
import { parseTrustProxy, TrustProxyConfigError, type TrustProxySetting } from "./trustProxy.js";

/**
 * Phase 85A — supertest connects from 127.0.0.1, so "the proxy" in these tests is the loopback
 * peer: a trusted proxy is configured as "loopback" (or 1 hop), and an untrusted direct caller is
 * modelled by trusting a different range (10.0.0.0/8) that 127.0.0.1 isn't in.
 */
function ipEchoApp(setting: TrustProxySetting, limit?: number) {
  const app = express();
  app.set("trust proxy", setting);
  if (limit !== undefined) {
    app.use(rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false }));
  }
  app.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

const ip = async (app: express.Express, xff?: string) => {
  const req = request(app).get("/ip");
  if (xff) req.set("X-Forwarded-For", xff);
  const res = await req;
  return { status: res.status, ip: res.body.ip as string | undefined };
};

describe("parseTrustProxy", () => {
  it("treats unset and explicit off values as trusting nothing", () => {
    for (const value of [undefined, "", "false", "none", "0", " FALSE "]) {
      expect(parseTrustProxy(value)).toBe(false);
    }
  });

  it("accepts a plausible hop count", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("accepts IPs, CIDR ranges and Express's named ranges", () => {
    expect(parseTrustProxy("loopback")).toEqual(["loopback"]);
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12,uniquelocal")).toEqual(["10.0.0.0/8", "172.16.0.0/12", "uniquelocal"]);
    expect(parseTrustProxy("203.0.113.7,2001:db8::/32")).toEqual(["203.0.113.7", "2001:db8::/32"]);
  });

  it('refuses "trust everything", which would let any client pick its own IP', () => {
    for (const value of ["true", "TRUE", "*", "all"]) {
      expect(() => parseTrustProxy(value)).toThrow(TrustProxyConfigError);
    }
  });

  it("refuses malformed values instead of guessing", () => {
    for (const value of ["99", "10.0.0.0/33", "not-an-ip", "10.0.0.1/8/1", "::1/129", ","]) {
      expect(() => parseTrustProxy(value)).toThrow(TrustProxyConfigError);
    }
  });
});

describe("client IP detection behind the edge", () => {
  it("direct request, nothing trusted: req.ip is the socket peer and X-Forwarded-For is ignored", async () => {
    const app = ipEchoApp(false);
    expect((await ip(app)).ip).toMatch(/127\.0\.0\.1$/);
    expect((await ip(app, "203.0.113.5")).ip).toMatch(/127\.0\.0\.1$/);
  });

  it("request through the trusted proxy: req.ip is the real client the proxy reports", async () => {
    expect((await ip(ipEchoApp(["loopback"]), "203.0.113.5")).ip).toBe("203.0.113.5");
    expect((await ip(ipEchoApp(1), "203.0.113.5")).ip).toBe("203.0.113.5");
  });

  it("spoofed X-Forwarded-For entries added by the client are ignored — only the proxy's own entry counts", async () => {
    // The client sent "6.6.6.6"; the proxy appended the address it actually saw.
    expect((await ip(ipEchoApp(["loopback"]), "6.6.6.6, 203.0.113.5")).ip).toBe("203.0.113.5");
    expect((await ip(ipEchoApp(1), "6.6.6.6, 203.0.113.5")).ip).toBe("203.0.113.5");
  });

  it("a caller that bypasses the trusted proxy cannot forge its address", async () => {
    // Only 10.0.0.0/8 is trusted; this connection comes from 127.0.0.1, so its header is ignored.
    expect((await ip(ipEchoApp(["10.0.0.0/8"]), "203.0.113.5")).ip).toMatch(/127\.0\.0\.1$/);
  });
});

describe("rate limiting keys on the real client IP", () => {
  it("behind the trusted proxy, each client gets its own bucket", async () => {
    const app = ipEchoApp(["loopback"], 2);
    expect((await ip(app, "203.0.113.10")).status).toBe(200);
    expect((await ip(app, "203.0.113.10")).status).toBe(200);
    expect((await ip(app, "203.0.113.10")).status).toBe(429);
    // A different client behind the same proxy is unaffected.
    expect((await ip(app, "203.0.113.20")).status).toBe(200);
  });

  it("a client cannot escape its bucket by rotating a spoofed leading X-Forwarded-For entry", async () => {
    const app = ipEchoApp(["loopback"], 2);
    expect((await ip(app, "1.1.1.1, 203.0.113.30")).status).toBe(200);
    expect((await ip(app, "2.2.2.2, 203.0.113.30")).status).toBe(200);
    expect((await ip(app, "3.3.3.3, 203.0.113.30")).status).toBe(429);
  });

  it("without trust proxy (the pre-85A behaviour), every client behind the proxy shares one bucket", async () => {
    const app = ipEchoApp(false, 2);
    expect((await ip(app, "203.0.113.40")).status).toBe(200);
    expect((await ip(app, "203.0.113.41")).status).toBe(200);
    expect((await ip(app, "203.0.113.42")).status).toBe(429);
  });
});

describe("createApp", () => {
  it("applies TRUST_PROXY to the real app exactly as parsed", () => {
    const reference = express();
    reference.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
    const expected = reference.get("trust proxy fn") as (addr: string, hop: number) => boolean;
    const actual = createApp().get("trust proxy fn") as (addr: string, hop: number) => boolean;
    for (const [addr, hop] of [["127.0.0.1", 0], ["10.1.2.3", 0], ["203.0.113.5", 1]] as const) {
      expect(actual(addr, hop)).toBe(expected(addr, hop));
    }
  });
});
