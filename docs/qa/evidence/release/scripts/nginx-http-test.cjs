// QA-011 — real HTTP responses from nginx 1.27.4 running the production templates (nginx-render.cjs).
const fs = require("fs");
const path = require("path");
const M = "http://localhost:8081", W = "http://localhost:8082", A = "http://localhost:8083";
const results = [];
async function check(label, url, expect) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  const h = (k) => res.headers.get(k);
  const problems = [];
  if (expect.status !== undefined && res.status !== expect.status) problems.push(`status ${res.status} ≠ ${expect.status}`);
  if (expect.shell && !body.includes('<div id="root">')) problems.push("not the app shell");
  if (expect.type && !(h("content-type") || "").includes(expect.type)) problems.push(`type ${h("content-type")}`);
  if (expect.header) for (const [k, v] of Object.entries(expect.header)) if (!(h(k) || "").includes(v)) problems.push(`header ${k}=${h(k)}`);
  if (expect.cache && !(h("cache-control") || "").includes(expect.cache)) problems.push(`cache-control ${h("cache-control")}`);
  if (expect.json && !body.trim().startsWith("{")) problems.push("not JSON (proxy?)");
  results.push({ label, url: url.replace(/^http:\/\/localhost:/, ":"), status: res.status, type: h("content-type"), cache: h("cache-control"), ok: problems.length === 0, problems });
}
(async () => {
  const shell = fs.readFileSync("D:/restaurant-os-white-label/apps/marketing/dist/index.html", "utf8");
  const asset = shell.match(/\/assets\/[^"]+\.js/)[0];
  const webShell = fs.readFileSync("D:/restaurant-os-white-label/apps/web/dist/index.html", "utf8");
  const webAsset = webShell.match(/\/assets\/[^"]+\.js/)[0];
  const sec = { "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors" };

  // Marketing — every page of the site answers 200 with the shell and no-cache.
  for (const p of ["/", "/about", "/contact", "/demo", "/faq", "/how-it-works", "/pricing", "/product", "/solutions", "/start-trial", "/v3", "/pricing/", "/Pricing"]) {
    await check(`marketing page ${p}`, M + p, { status: 200, shell: true, cache: "no-cache", header: sec });
  }
  for (const p of ["/terms", "/privacy", "/refund-policy"]) {
    await check(`marketing legal ${p}`, M + p, { status: 200, shell: true, header: { ...sec, "x-robots-tag": "noindex" } });
  }
  // Unknown paths and the dev-only draft: 404 status, still the app shell (which renders the 404 page).
  for (const p of ["/no-such-page", "/v2", "/pricing/extra", "/deep/unknown/path", "/index"]) {
    await check(`marketing unknown ${p}`, M + p, { status: 404, shell: true, header: sec });
  }
  // Static files.
  await check("marketing robots.txt", M + "/robots.txt", { status: 200, type: "text/plain" });
  await check("marketing sitemap.xml", M + "/sitemap.xml", { status: 200, type: "xml" });
  await check("marketing og-image.png", M + "/og-image.png", { status: 200, type: "image/png" });
  await check("marketing favicon.svg", M + "/favicon.svg", { status: 200, type: "image/svg" });
  await check("marketing /v3 image", M + "/v3/logo-mark.png", { status: 200, type: "image/png" });
  await check("marketing hashed asset", M + asset, { status: 200, type: "javascript", cache: "immutable" });
  await check("marketing missing asset", M + "/assets/missing-file.js", { status: 404 });
  await check("marketing index.html", M + "/index.html", { status: 200, cache: "no-cache" });
  await check("marketing API proxy", M + "/api/v1/public/plans", { status: 200, json: true });

  // Storefront — SPA fallback by design (restaurant slugs, tables and custom domains are dynamic).
  for (const p of ["/", "/r/demo-restaurant", "/r/demo-restaurant/cart", "/orders", "/support", "/login", "/r/no-such-restaurant", "/no-such-page"]) {
    await check(`storefront ${p}`, W + p, { status: 200, shell: true, header: { "x-content-type-options": "nosniff" } });
  }
  await check("storefront menu image dir as route", W + "/menu-images", { status: 200, shell: true });
  await check("storefront hashed asset", W + webAsset, { status: 200, cache: "immutable" });
  await check("storefront API proxy", W + "/api/v1/restaurants/by-slug/demo-restaurant", { status: 200, json: true });

  // Admin — SPA fallback by design.
  for (const p of ["/login", "/platform", "/agency", "/settings", "/print/receipt/abc", "/no-such-page"]) {
    await check(`admin ${p}`, A + p, { status: 200, shell: true });
  }
  await check("admin restaurant image", A + "/restaurant-images/wildwood-kitchen-logo.svg", { status: 200, type: "image/svg" });
  await check("admin API proxy", A + "/api/v1/public/plans", { status: 200, json: true });

  const fails = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${String(r.status).padEnd(4)} ${r.label}${r.ok ? "" : " — " + r.problems.join("; ")}`);
  console.log(`TOTAL ${results.length} PASS ${results.length - fails.length} FAIL ${fails.length}`);
  fs.writeFileSync(path.join(__dirname, "out", "nginx-http-results.json"), JSON.stringify(results, null, 2));
})();
