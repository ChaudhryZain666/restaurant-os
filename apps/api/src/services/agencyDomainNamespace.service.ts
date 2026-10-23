import { Agency } from "../models/Agency.js";

/**
 * White-label agency-owned domains. An agency that has DNS-verified its own domain (Agency settings,
 * `_garnishtable-verify.<domain>` TXT) owns that domain's namespace on this platform: its client
 * locations can serve storefronts on hostnames under it (e.g. `elrancho.mediabymiller.com`), and
 * no other tenant can claim or serve one. This only decides ownership — each hostname still goes
 * through the normal DomainMapping lifecycle (activate, CNAME to the edge, on-demand TLS via
 * resolveCustomDomain), so a verified agency domain never routes traffic by itself.
 */

/** `a.b.example.com` → [`a.b.example.com`, `b.example.com`, `example.com`] (no bare TLD). */
export function hostnameSuffixes(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out;
}

/** The agency whose DNS-verified domain contains `hostname` (the most specific one), or null. */
export async function findVerifiedAgencyForHostname(hostname: string) {
  const suffixes = hostnameSuffixes(hostname);
  if (suffixes.length === 0) return null;
  const agencies = await Agency.find({ domain: { $in: suffixes }, domainStatus: "verified" }).select("_id domain");
  if (agencies.length === 0) return null;
  // Most specific (longest) domain wins; uniqueness of verified domains means no tie.
  return agencies.sort((a, b) => (b.domain?.length ?? 0) - (a.domain?.length ?? 0))[0];
}
