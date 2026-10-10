// Phase 88/89 — validation of the founder-supplied legal values (src/lib/legal.ts) for a production
// build of the marketing site. Plain ESM so `node --test legalConfig.test.mjs` can exercise it with
// no extra dependency; vite.config.ts calls it.
//
// Option C (Phase 89): providing NONE of the values is allowed — the build continues with a loud
// warning and the legal pages show "Legal documents are being finalized". Providing SOME but not
// all, a placeholder, or a malformed email still fails the build, exactly as before.

export const LEGAL_VARIABLES = [
  "VITE_LEGAL_ENTITY_NAME",
  "VITE_LEGAL_JURISDICTION",
  "VITE_LEGAL_CONTACT_EMAIL",
  "VITE_PRIVACY_CONTACT_EMAIL",
  "VITE_BILLING_CONTACT_EMAIL",
];

const PLACEHOLDER_VALUE = /\[|\]|localhost|127\.0\.0\.1|\.local\b|example\.(com|org|net)|changeme|todo|tbd/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export const LEGAL_NOT_CONFIGURED_WARNING = [
  "",
  "  ⚠  LEGAL PAGES NOT CONFIGURED — production-readiness blocker",
  "     None of the five VITE_LEGAL_* values were provided, so /terms, /privacy and /refund-policy",
  '     will say "Legal documents are being finalized" (noindexed). Provide all five values before',
  "     launching paid plans. See apps/marketing/src/lib/legal.ts.",
  "",
].join("\n");

/** The three legal pages, as sitemap paths. */
export const LEGAL_PAGE_PATHS = ["/terms", "/privacy", "/refund-policy"];

/**
 * Phase 89 — the sitemap without the legal pages (removed while they only say "being finalized",
 * so search engines aren't invited to index a placeholder). Every other entry is left byte-for-byte.
 * @param {string} xml
 * @returns {string}
 */
export function sitemapWithoutLegalPages(xml) {
  return xml.replace(/[ \t]*<url>\s*<loc>([^<]*)<\/loc>[\s\S]*?<\/url>[ \t]*\r?\n?/g, (entry, loc) => {
    const path = loc.trim().replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";
    return LEGAL_PAGE_PATHS.includes(path) ? "" : entry;
  });
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ configured: boolean, problems: string[] }} configured=false with no problems means
 *   "none provided" (allowed, warn); any problems mean the build must fail.
 */
export function checkLegalConfig(env) {
  const values = LEGAL_VARIABLES.map((name) => [name, (env[name] ?? "").trim()]);
  if (values.every(([, value]) => !value)) return { configured: false, problems: [] };

  const problems = [];
  for (const [name, value] of values) {
    if (!value) problems.push(`${name} is not set (provide all five legal values, or none)`);
    else if (PLACEHOLDER_VALUE.test(value)) problems.push(`${name} looks like a placeholder`);
    else if (name.endsWith("_EMAIL") && !EMAIL.test(value)) problems.push(`${name} is not an email address`);
  }
  return { configured: problems.length === 0, problems };
}
