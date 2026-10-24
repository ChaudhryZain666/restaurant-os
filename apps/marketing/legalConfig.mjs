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
export const LEGAL_REVIEW_APPROVAL_VARIABLE = "VITE_LEGAL_REVIEW_APPROVED";

const PLACEHOLDER_VALUE = /\[|\]|localhost|127\.0\.0\.1|\.local\b|example\.(com|org|net)|changeme|todo|tbd/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export const LEGAL_NOT_CONFIGURED_WARNING = [
  "",
  "  ⚠  LEGAL PAGES NOT PUBLISHED — production-readiness blocker",
  "     /terms, /privacy and /refund-policy remain pending/noindexed until all five legal facts are valid",
  "     AND VITE_LEGAL_REVIEW_APPROVED=true after the review checklist is complete.",
  "     Never set approval merely to remove this notice. See docs/legal-readiness-review.md.",
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
  const approval = (env[LEGAL_REVIEW_APPROVAL_VARIABLE] ?? "").trim().toLowerCase();
  const allEmpty = values.every(([, value]) => !value);
  if (allEmpty && approval !== "true") return { configured: false, problems: [] };

  const problems = [];
  for (const [name, value] of values) {
    if (!value) problems.push(`${name} is not set (provide all five legal values, or none)`);
    else if (PLACEHOLDER_VALUE.test(value)) problems.push(`${name} looks like a placeholder`);
    else if (name.endsWith("_EMAIL") && !EMAIL.test(value)) problems.push(`${name} is not an email address`);
  }
  if (approval !== "" && approval !== "true" && approval !== "false") problems.push(`${LEGAL_REVIEW_APPROVAL_VARIABLE} must be "true" or "false" when set`);
  if (approval === "true" && allEmpty) problems.push(`${LEGAL_REVIEW_APPROVAL_VARIABLE}=true requires all five legal facts`);
  return { configured: problems.length === 0 && approval === "true", problems };
}
