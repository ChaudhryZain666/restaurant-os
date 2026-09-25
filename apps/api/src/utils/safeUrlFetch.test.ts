import { EventEmitter } from "node:events";
import dns from "node:dns";
import { request as httpsRequest } from "node:https";
import { safeUrlFetch, isPublicIpv4, isPublicIpv6 } from "./safeUrlFetch.js";

jest.mock("node:https", () => ({ request: jest.fn() }));
jest.mock("node:dns", () => ({
  promises: { lookup: jest.fn() },
}));

const mockedRequest = httpsRequest as unknown as jest.Mock;
const mockedLookup = dns.promises.lookup as unknown as jest.Mock;

const DEFAULT_OPTS = {
  allowedContentTypes: ["text/html", "application/pdf"],
  maxBytes: 1024,
  maxRedirects: 3,
  timeoutMs: 5000,
};

/** Builds a fake ClientRequest/IncomingMessage pair and wires mockedRequest to invoke the response
 *  callback with it — mirrors node:https' own request(options, callback) shape closely enough for
 *  safeUrlFetch's own logic (status/headers/data/end/error) without needing a real socket. */
function mockOneHop(status: number, headers: Record<string, string>, bodyChunks: string[]) {
  mockedRequest.mockImplementationOnce((_options: unknown, callback: (res: EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void }) => void) => {
    const req = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
    req.destroy = jest.fn();
    req.end = jest.fn(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
      res.statusCode = status;
      res.headers = headers;
      res.resume = jest.fn();
      callback(res);
      queueMicrotask(() => {
        for (const chunk of bodyChunks) res.emit("data", Buffer.from(chunk));
        res.emit("end");
      });
    });
    return req;
  });
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedLookup.mockReset();
});

describe("safeUrlFetch", () => {
  it("rejects a plain http:// URL before any network call", async () => {
    await expect(safeUrlFetch("http://example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({ code: "invalid_protocol" });
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("rejects an unparseable URL", async () => {
    await expect(safeUrlFetch("not a url", DEFAULT_OPTS)).rejects.toMatchObject({ code: "invalid_protocol" });
  });

  it.each([
    ["10.0.0.5", 4],
    ["172.16.0.1", 4],
    ["192.168.1.1", 4],
    ["127.0.0.1", 4],
    ["169.254.169.254", 4], // the cloud metadata endpoint, explicitly
    ["0.0.0.0", 4],
    ["::1", 6],
    ["fe80::1", 6],
    ["fc00::1", 6],
  ])("rejects a hostname resolving to the private/reserved address %s", async (address, family) => {
    mockedLookup.mockResolvedValueOnce([{ address, family }]);
    await expect(safeUrlFetch("https://internal.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({ code: "private_ip" });
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("rejects a hostname whose resolved set mixes a public and a private address", async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(safeUrlFetch("https://mixed.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({ code: "private_ip" });
  });

  it("accepts a genuinely public IP and dials it directly (not the hostname)", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockOneHop(200, { "content-type": "text/html" }, ["<html>menu</html>"]);

    const result = await safeUrlFetch("https://real-restaurant.example.com/menu", DEFAULT_OPTS);

    expect(result.body.toString()).toBe("<html>menu</html>");
    expect(result.contentType).toBe("text/html");
    const [options] = mockedRequest.mock.calls[0];
    expect(options.host).toBe("93.184.216.34"); // dialed the IP
    expect(options.headers.Host).toBe("real-restaurant.example.com"); // Host header kept the real hostname
    expect(options.servername).toBe("real-restaurant.example.com"); // TLS SNI kept the real hostname
  });

  it("re-validates every redirect hop independently — a rebinding attempt on hop 2 is rejected", async () => {
    // Hop 1: public IP, but the response redirects to an internal host.
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockOneHop(302, { location: "https://internal.attacker.example.com/steal" }, []);
    // Hop 2: that host resolves privately — must be rejected, never fetched.
    mockedLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    await expect(safeUrlFetch("https://public.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({ code: "private_ip" });
    expect(mockedRequest).toHaveBeenCalledTimes(1); // hop 2 never actually reached fetchOneHop
  });

  it("follows a genuinely public-to-public redirect chain within the limit", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
    mockOneHop(301, { location: "https://public2.example.com/menu" }, []);
    mockedLookup.mockResolvedValueOnce([{ address: "1.1.1.2", family: 4 }]);
    mockOneHop(200, { "content-type": "text/html" }, ["final page"]);

    const result = await safeUrlFetch("https://public1.example.com/menu", DEFAULT_OPTS);
    expect(result.body.toString()).toBe("final page");
    expect(result.finalUrl).toBe("https://public2.example.com/menu");
  });

  it("rejects once the redirect count exceeds the limit", async () => {
    for (let i = 0; i < 5; i++) {
      mockedLookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
      mockOneHop(302, { location: `https://example.com/hop${i + 1}` }, []);
    }
    await expect(safeUrlFetch("https://example.com/hop0", { ...DEFAULT_OPTS, maxRedirects: 3 })).rejects.toMatchObject({
      code: "too_many_redirects",
    });
  });

  it("aborts and rejects once the streamed response exceeds maxBytes, never buffering it fully", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockOneHop(200, { "content-type": "text/html" }, ["a".repeat(2000)]); // exceeds DEFAULT_OPTS.maxBytes (1024)

    await expect(safeUrlFetch("https://big.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("rejects a disallowed content-type before reading any body", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockOneHop(200, { "content-type": "application/octet-stream" }, ["binary junk"]);

    await expect(safeUrlFetch("https://weird.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({
      code: "unsupported_content_type",
    });
  });

  it("surfaces a non-2xx/3xx status as a distinct, honest error", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockOneHop(404, { "content-type": "text/html" }, ["not found"]);

    await expect(safeUrlFetch("https://gone.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({ code: "http_error" });
  });

  it("times out via AbortController when the request never completes", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockedRequest.mockImplementationOnce((options: { signal: AbortSignal }) => {
      const req = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
      req.destroy = jest.fn();
      req.end = jest.fn(); // never calls the callback — simulates a hung connection
      options.signal.addEventListener("abort", () => req.emit("error", new Error("aborted")));
      return req;
    });

    await expect(safeUrlFetch("https://hangs.example.com/menu", { ...DEFAULT_OPTS, timeoutMs: 10 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("treats DNS resolution failure as a distinct, honest error", async () => {
    mockedLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(safeUrlFetch("https://nowhere.example.com/menu", DEFAULT_OPTS)).rejects.toMatchObject({
      code: "dns_resolution_failed",
    });
  });
});

describe("isPublicIpv4", () => {
  it("rejects every documented private/reserved range", () => {
    expect(isPublicIpv4("10.1.2.3")).toBe(false);
    expect(isPublicIpv4("172.31.255.255")).toBe(false);
    expect(isPublicIpv4("192.168.0.1")).toBe(false);
    expect(isPublicIpv4("127.0.0.1")).toBe(false);
    expect(isPublicIpv4("169.254.169.254")).toBe(false);
    expect(isPublicIpv4("100.64.0.1")).toBe(false);
  });
  it("accepts a real public address", () => {
    expect(isPublicIpv4("93.184.216.34")).toBe(true);
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });
});

describe("isPublicIpv6", () => {
  it("rejects loopback, link-local, unique-local, and multicast", () => {
    expect(isPublicIpv6("::1")).toBe(false);
    expect(isPublicIpv6("fe80::1")).toBe(false);
    expect(isPublicIpv6("fc00::1")).toBe(false);
    expect(isPublicIpv6("ff02::1")).toBe(false);
  });
  it("rejects an IPv4-mapped private address via the embedded IPv4 check", () => {
    expect(isPublicIpv6("::ffff:169.254.169.254")).toBe(false);
  });
  it("accepts a real public IPv6 address", () => {
    expect(isPublicIpv6("2606:4700:4700::1111")).toBe(true);
  });
  it("fails closed on an unparseable address", () => {
    expect(isPublicIpv6("not-an-address")).toBe(false);
  });
});
