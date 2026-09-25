import { request as httpsRequest } from "node:https";
import dns from "node:dns";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Phase 81 — a from-scratch SSRF-safe fetcher for the menu-URL importer (nothing like this existed
 * anywhere in this codebase before: every prior server-side fetch() targets a hardcoded,
 * compile-time-constant provider host, never a restaurant-owner-supplied URL). Built on Node's core
 * `https` module rather than `fetch`/undici specifically so the actual TCP connection can be dialed
 * against the exact IP address that was just DNS-validated — the URL's hostname is used ONLY for
 * the `Host` header and TLS SNI (`servername`), never for a second, independent DNS resolution at
 * connect time. That second, independent resolution is precisely the DNS-rebinding gap (a hostname
 * resolving to a safe IP at validation time, then a different — internal — IP at actual connect
 * time): dialing the already-validated IP literally closes it, rather than merely reducing its
 * window.
 *
 * Every redirect hop is re-validated independently (manual redirect handling, never
 * `redirect:"follow"`), the response body is size-capped while streaming (never buffered
 * unbounded), and content-type is checked from headers before any body byte is read.
 */

export type SafeFetchErrorCode =
  | "invalid_protocol"
  | "private_ip"
  | "too_many_redirects"
  | "response_too_large"
  | "timeout"
  | "unsupported_content_type"
  | "dns_resolution_failed"
  | "http_error";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly code: SafeFetchErrorCode
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

export interface SafeFetchOptions {
  allowedContentTypes: readonly string[];
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
}

// --- IP range checks -------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0) as number;
}

function inIpv4Cidr(ip: string, cidr: string): boolean {
  const [rangeIp, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(rangeIp) & mask);
}

// RFC 1918 private ranges, loopback, link-local (includes the AWS/GCP/Azure metadata endpoint
// 169.254.169.254 explicitly), carrier-grade NAT, documentation/test, benchmark, multicast,
// reserved, and broadcast — every block a hostname must never be allowed to resolve to.
const IPV4_BLOCKED_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

export function isPublicIpv4(ip: string): boolean {
  return !IPV4_BLOCKED_RANGES.some((range) => inIpv4Cidr(ip, range));
}

/** Minimal, dependency-free IPv6 text-form parser (handles "::" compression and an embedded IPv4
 *  tail like "::ffff:1.2.3.4") — returns 16 bytes, or null for anything unparseable (callers must
 *  treat null as unsafe/reject, never as "assume public"). */
function parseIpv6(ip: string): number[] | null {
  const addr = ip.split("%")[0]; // strip a zone id (e.g. fe80::1%eth0) if present
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  function expand(part: string): string[] {
    return part === "" ? [] : part.split(":");
  }
  function expandEmbeddedV4(groups: string[]): string[] | null {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1];
    if (!last.includes(".")) return groups;
    const v4 = last.split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const hex1 = (((v4[0] << 8) | v4[1]) >>> 0).toString(16);
    const hex2 = (((v4[2] << 8) | v4[3]) >>> 0).toString(16);
    return [...groups.slice(0, -1), hex1, hex2];
  }

  let head = expand(halves[0]);
  let tail = halves.length === 2 ? expand(halves[1]) : [];
  const headExpanded = expandEmbeddedV4(head);
  const tailExpanded = expandEmbeddedV4(tail);
  if (headExpanded === null || tailExpanded === null) return null;
  head = headExpanded;
  tail = tailExpanded;

  let fullGroups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    fullGroups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    fullGroups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (fullGroups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of fullGroups) {
    const n = parseInt(g || "0", 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

export function isPublicIpv6(ip: string): boolean {
  const bytes = parseIpv6(ip);
  if (!bytes) return false; // unparseable — fail closed, never treat as safe

  const isZero = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);

  if (isZero(0, 16)) return false; // :: unspecified
  if (isZero(0, 15) && bytes[15] === 1) return false; // ::1 loopback
  if ((bytes[0] & 0xfe) === 0xfc) return false; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (bytes[0] === 0xff) return false; // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false; // 2001:db8::/32 documentation

  // ::ffff:a.b.c.d — IPv4-mapped; the embedded IPv4 address is what actually matters.
  if (isZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  return true;
}

function isPublicIp(address: string, family: number): boolean {
  return family === 6 ? isPublicIpv6(address) : isPublicIpv4(address);
}

// --- resolution --------------------------------------------------------------------------------

/** Resolves a hostname and rejects it outright if ANY returned address is private/reserved — a
 *  hostname with a mixed public/private A-record set is never partially trusted. Returns the
 *  address actually used for the connection, which the caller dials literally (see module header). */
async function resolvePublicIp(hostname: string): Promise<string> {
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new SafeFetchError(`Could not resolve host "${hostname}".`, "dns_resolution_failed");
  }
  if (addresses.length === 0) {
    throw new SafeFetchError(`Could not resolve host "${hostname}".`, "dns_resolution_failed");
  }
  for (const { address, family } of addresses) {
    if (!isPublicIp(address, family)) {
      throw new SafeFetchError(`"${hostname}" resolves to a private or reserved address and cannot be fetched.`, "private_ip");
    }
  }
  return addresses[0].address;
}

// --- single-hop fetch ----------------------------------------------------------------------------

interface HopResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  contentType: string;
}

function fetchOneHop(url: URL, resolvedIp: string, opts: SafeFetchOptions): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = httpsRequest(
      {
        host: resolvedIp, // dial the DNS-validated IP literally — see module header comment
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { Host: url.hostname, "User-Agent": "GarnishTable-MenuImporter/1.0" },
        servername: url.hostname, // TLS SNI must match the real hostname, not the dialed IP
        signal: controller.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = (res.headers["content-type"] ?? "").split(";")[0].trim();

        if (status >= 300 && status < 400) {
          res.resume(); // redirect — never read this hop's body into memory
          settle(() => resolve({ status, headers: res.headers, body: Buffer.alloc(0), contentType }));
          return;
        }

        if (status >= 200 && status < 300 && !opts.allowedContentTypes.includes(contentType)) {
          res.resume();
          settle(() =>
            reject(new SafeFetchError(`This source's content type ("${contentType || "unknown"}") isn't supported.`, "unsupported_content_type"))
          );
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBytes) {
            req.destroy();
            settle(() => reject(new SafeFetchError(`The response exceeded the ${Math.round(opts.maxBytes / (1024 * 1024))}MB limit.`, "response_too_large")));
          } else {
            chunks.push(chunk);
          }
        });
        res.on("end", () => settle(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), contentType })));
        res.on("error", (err: Error) => settle(() => reject(err)));
      }
    );

    req.on("error", (err: Error) => {
      settle(() => reject(controller.signal.aborted ? new SafeFetchError("The request timed out.", "timeout") : err));
    });
    req.end();
  });
}

// --- public entry point -------------------------------------------------------------------------

export async function safeUrlFetch(inputUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = new URL(inputUrl);
  } catch {
    throw new SafeFetchError("That doesn't look like a valid URL.", "invalid_protocol");
  }

  for (let hop = 0; ; hop++) {
    if (current.protocol !== "https:") {
      throw new SafeFetchError("Only https:// URLs are supported.", "invalid_protocol");
    }
    const resolvedIp = await resolvePublicIp(current.hostname);
    const result = await fetchOneHop(current, resolvedIp, opts);

    if (result.status >= 300 && result.status < 400) {
      if (hop >= opts.maxRedirects) {
        throw new SafeFetchError(`Too many redirects (limit ${opts.maxRedirects}).`, "too_many_redirects");
      }
      const location = result.headers.location;
      if (!location || Array.isArray(location)) {
        throw new SafeFetchError("The source redirected without a usable destination.", "http_error");
      }
      try {
        current = new URL(location, current);
      } catch {
        throw new SafeFetchError("The source redirected to an invalid URL.", "http_error");
      }
      continue;
    }

    if (result.status < 200 || result.status >= 300) {
      throw new SafeFetchError(`The source responded with an unexpected status (${result.status}).`, "http_error");
    }

    return { body: result.body, contentType: result.contentType, finalUrl: current.toString() };
  }
}
