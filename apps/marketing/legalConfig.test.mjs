// Phase 89 (option C) — run with `npm test -w apps/marketing` (node --test, no extra dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLegalConfig, LEGAL_VARIABLES, LEGAL_REVIEW_APPROVAL_VARIABLE, sitemapWithoutLegalPages } from "./legalConfig.mjs";

const VALID = {
  VITE_LEGAL_ENTITY_NAME: "Test Entity Ltd",
  VITE_LEGAL_JURISDICTION: "Testland",
  VITE_LEGAL_CONTACT_EMAIL: "legal@garnishtable.com",
  VITE_PRIVACY_CONTACT_EMAIL: "privacy@garnishtable.com",
  VITE_BILLING_CONTACT_EMAIL: "billing@garnishtable.com",
};

test("none provided: allowed, not configured, no problems (pages show 'being finalized')", () => {
  assert.deepEqual(checkLegalConfig({}), { configured: false, problems: [] });
  assert.deepEqual(checkLegalConfig(Object.fromEntries(LEGAL_VARIABLES.map((n) => [n, "   "]))), { configured: false, problems: [] });
});

test("all five valid without explicit approval: pages stay pending", () => {
  assert.deepEqual(checkLegalConfig(VALID), { configured: false, problems: [] });
});

test("all five valid plus explicit approval: configured", () => {
  assert.deepEqual(checkLegalConfig({ ...VALID, [LEGAL_REVIEW_APPROVAL_VARIABLE]: "true" }), { configured: true, problems: [] });
});

test("explicit false keeps pages pending", () => {
  assert.deepEqual(checkLegalConfig({ ...VALID, [LEGAL_REVIEW_APPROVAL_VARIABLE]: "false" }), { configured: false, problems: [] });
});

test("approval without legal facts fails closed", () => {
  const result = checkLegalConfig({ [LEGAL_REVIEW_APPROVAL_VARIABLE]: "true" });
  assert.equal(result.configured, false);
  assert.ok(result.problems.length > 0);
});

test("a partial set fails — all five or none", () => {
  const { configured, problems } = checkLegalConfig({ VITE_LEGAL_ENTITY_NAME: "Test Entity Ltd", VITE_LEGAL_JURISDICTION: "Testland", VITE_LEGAL_CONTACT_EMAIL: "legal@garnishtable.com" });
  assert.equal(configured, false);
  assert.equal(problems.length, 2);
  assert.match(problems.join(), /VITE_PRIVACY_CONTACT_EMAIL is not set/);
});

test("a placeholder value fails", () => {
  const { problems } = checkLegalConfig({ ...VALID, VITE_LEGAL_ENTITY_NAME: "[LEGAL_ENTITY_NAME]" });
  assert.match(problems.join(), /VITE_LEGAL_ENTITY_NAME looks like a placeholder/);
});

test("an example.com email fails as a placeholder", () => {
  const { problems } = checkLegalConfig({ ...VALID, VITE_BILLING_CONTACT_EMAIL: "billing@example.com" });
  assert.match(problems.join(), /VITE_BILLING_CONTACT_EMAIL looks like a placeholder/);
});

test("a malformed email fails", () => {
  const { problems } = checkLegalConfig({ ...VALID, VITE_PRIVACY_CONTACT_EMAIL: "privacy-at-garnishtable" });
  assert.match(problems.join(), /VITE_PRIVACY_CONTACT_EMAIL is not an email address/);
});

test("sitemap: the three legal pages are removed, every other entry is kept exactly", async () => {
  const original = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "public", "sitemap.xml"), "utf8");
  const filtered = sitemapWithoutLegalPages(original);
  for (const path of ["/terms", "/privacy", "/refund-policy"]) assert.ok(!filtered.includes(`${path}</loc>`), `${path} still listed`);
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs(filtered), locs(original).filter((l) => !/\/(terms|privacy|refund-policy)$/.test(l)));
  assert.ok(locs(filtered).length > 0 && filtered.trim().endsWith("</urlset>"));
});
