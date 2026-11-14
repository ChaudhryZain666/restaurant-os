// QA-010 / QA-011 — nginx answers the marketing site's real pages with 200 and anything else with a
// 404 status (infrastructure/docker/nginx/marketing.locations.template). This keeps that list in
// step with the app's routes, so a new page can never ship as a 404, and checks the /v2 draft
// stays out of production builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const app = readFileSync(join(here, "src/App.tsx"), "utf8");
const nginx = readFileSync(join(here, "../../infrastructure/docker/nginx/marketing.locations.template"), "utf8");
const sitemap = readFileSync(join(here, "public/sitemap.xml"), "utf8");

const appRoutes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
const devOnlyRoutes = [...app.matchAll(/import\.meta\.env\.DEV && <Route path="([^"]+)"/g)].map((m) => m[1]);
const publicRoutes = appRoutes.filter((p) => p !== "*" && !devOnlyRoutes.includes(p));

const regexBodies = [...nginx.matchAll(/location ~ \^\/\(([^)]+)\)\/\?\$/g)].map((m) => m[1].split("|"));
const servedWith200 = new Set(["/", ...regexBodies.flat().map((s) => `/${s}`)]);

test("every public page of the app is served with 200", () => {
  assert.ok(nginx.includes("location = / {"), "the homepage has its own location");
  const missing = publicRoutes.filter((p) => !servedWith200.has(p));
  assert.deepEqual(missing, []);
});

test("nginx lists no page the app doesn't have", () => {
  const extra = [...servedWith200].filter((p) => !publicRoutes.includes(p));
  assert.deepEqual(extra, []);
});

test("the /v2 draft homepage is dev-only and not served with 200", () => {
  assert.deepEqual(devOnlyRoutes, ["/v2"]);
  assert.ok(!servedWith200.has("/v2"));
  assert.ok(!sitemap.includes("/v2<"));
});

test("everything else gets the app shell with a 404 status", () => {
  assert.match(nginx, /location ~ \^\/\(\?!assets\/\|api\/\) \{\s*try_files \$uri =404;\s*error_page 404 \/index\.html;/);
});
