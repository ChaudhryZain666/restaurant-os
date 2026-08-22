import { z } from "zod";

// Phase 22 — a custom domain must be stored as a bare hostname, never an arbitrary URL. Normalize
// first (so "HTTPS://Orders.Example.com/" and "orders.example.com" collide, not silently diverge
// into two DB rows), then validate what's left is actually a syntactically valid hostname — reject
// rather than guess when it isn't (e.g. "https://example.com/path" is rejected outright, not
// silently trimmed down to "example.com" behind the caller's back).
//
// This module intentionally has no knowledge of the platform's own configured origin (this package
// has no env access, and shouldn't) — rejecting a self-claim attempt against the platform's own
// domain is an application-layer check, done where env config is actually available.

export function normalizeHostname(input: string): string {
  // Only forgives superficial formatting (case, surrounding whitespace, a leading protocol, one
  // trailing dot) — deliberately does NOT strip a path/query/fragment. "https://example.com/path"
  // must be rejected outright by isValidHostname below, not silently reduced to "example.com".
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "");
  value = value.replace(/\/$/, ""); // a bare trailing "/" (root path, semantically empty) only
  value = value.replace(/\.$/, "");
  return value;
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.includes(" ") || hostname.includes(":") || hostname.includes("[")) return false;
  if (IPV4_RE.test(hostname)) return false;
  if (!hostname.includes(".")) return false; // a bare label ("localhost", "acme") is never a real custom domain
  try {
    const url = new URL(`http://${hostname}`);
    return url.hostname === hostname && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export const domainHostnameSchema = z
  .string()
  .min(1, "Domain is required")
  .transform((value) => normalizeHostname(value))
  .refine((value) => isValidHostname(value), {
    message: "Must be a valid hostname (e.g. orders.example.com) — not a URL, IP address, or path",
  });

export const addDomainSchema = z.object({ hostname: domainHostnameSchema });
export type AddDomainInput = z.infer<typeof addDomainSchema>;
