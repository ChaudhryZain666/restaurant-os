// Full per-route verification: all 109 routes (16 marketing, 26 storefront, 67 admin) on the LOCAL
// stack (fix/full-browser-qa-findings, isolated restaurant_platform_e2e DB, mock providers).
// Per route: direct load as the right role, rendering, console/network, route-specific functional
// test, safe-controls sweep, empty-form submit, refresh, Back/Forward, 390px overflow, and access
// checks (signed-out + a wrong role). Writes out/routes-all/results.json.
const fs = require("fs");
const path = require("path");
const { chromium } = require("D:/restaurant-os-white-label/node_modules/playwright");

const OUT = path.join(__dirname, "out", "routes-all");
const WEB = "http://localhost:5173";
const WEBP = "http://localhost:5176";
const ADMIN = "http://localhost:5174";
const MKT = "http://localhost:5175";
const MKTB = "http://localhost:5177"; // production build (vite preview)
const API = "http://localhost:4000/api/v1";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const APPF = process.env.APP || null;

const seed = fs.readFileSync("D:/restaurant-os-white-label/apps/api/src/scripts/seed-demo-data.ts", "utf8");
const pw = (prefix) => seed.match(new RegExp(`bcrypt\\.hash\\("(${prefix}[^"]*)"`))[1];
const CREDS = {
  admin: ["platform-admin@restaurant.local", pw("Admin")],
  owner: ["owner@demo-restaurant.local", pw("Owner")],
  manager: ["manager@demo-restaurant.local", pw("Staff")],
  staff: ["staff@demo-restaurant.local", pw("Staff")],
  kitchen: ["kitchen@demo-restaurant.local", pw("Staff")],
  customer: ["jordan.lee@example.com", pw("Customer")],
};
const stamp = Date.now();
const AGENCY = { email: `qa-routes-agency-${stamp}@test.local`, password: "QaRoutes123!" };

const api = async (token, p, opts = {}) => {
  const r = await fetch(API + p, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
};
const login = async ([email, password]) => (await api(null, "/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })).body?.data;
const settle = (page, ms = 8000) => page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
const ok = (c, m) => { if (!c) throw new Error(m); };
const mainText = async (page) => (await page.locator("main").first().innerText().catch(() => page.locator("body").innerText())).replace(/\s+/g, " ");
const h1 = async (page) => page.getByRole("heading", { level: 1 }).first().innerText({ timeout: 3000 }).catch(() => "(no h1)");
const waitText = (page, re, timeout = 10000) => page.getByText(re).first().waitFor({ timeout });

const DESTRUCTIVE = /available|sold out|hide|feature|default|toggle|duplicate|move|reorder|delete|remove|archive|suspend|cancel|log ?out|sign ?out|refund|deactivate|disconnect|reject|void|clear|reset|regenerate|revoke|pay\b|pay |place order|complete|publish|send|invite|resend|approve|close|mark |accept|ready|start|upgrade|downgrade|change plan|subscribe|checkout|connect|activate|transfer|extend|resume|complimentary|save|create|add|update|confirm|apply|submit|verify|import|upload|test print|print|reprint|charge|refund|enable|disable|pause|unpause|dismiss|skip|finish|launch|go live|request|retry|reorder|track|copy|download|export|switch|enter|leave|exit|new |next|back to|done/i;

async function adminLogin(page, [email, password]) {
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  await settle(page);
}
async function webLogin(page, [email, password]) {
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^(Log in|Sign in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function sweep(page, url) {
  const tested = [];
  const problems = [];
  const items = await page.evaluate((destructiveSrc) => {
    const destructive = new RegExp(destructiveSrc, "i");
    const root = document.querySelector("main") || document.body;
    const els = [...root.querySelectorAll('button, a[href], [role="tab"], select')];
    const out = [];
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none") return;
      if (el.disabled) return;
      // Never touch controls that save on change: switches/toggles, and selects inside a record
      // (a staff row's role dropdown saves immediately — an earlier run changed real roles that way).
      if (el.getAttribute("role") === "switch" || el.hasAttribute("aria-pressed") || el.hasAttribute("aria-checked")) return;
      if (el.tagName === "SELECT") {
        const label = (el.getAttribute("aria-label") || el.name || el.id || "").toLowerCase();
        const inRecord = el.closest("table, li, [role=row], form, [role=listitem], article");
        if (inRecord || !/filter|sort|status|range|period|show|location|type|category|per page|interval/.test(label)) return;
      }
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (el.tagName === "BUTTON" && el.getAttribute("type") === "submit") return;
      if (el.tagName === "A") {
        const href = el.getAttribute("href") || "";
        if (/^(mailto:|tel:|javascript:)/.test(href)) return;
        if (/^https?:/.test(href) && !href.startsWith(location.origin)) return;
        if (el.getAttribute("target") === "_blank") return;
        if (href.startsWith("#") && el.tagName === "A") { /* in-page anchor: fine */ }
      }
      if (el.tagName !== "SELECT" && destructive.test(name)) return;
      if (!name && el.tagName !== "SELECT") return;
      el.setAttribute("data-qa-sweep", String(i));
      out.push({ idx: String(i), tag: el.tagName, name });
    });
    return out.slice(0, 18);
  }, DESTRUCTIVE.source);
  for (const it of items) {
    const before = page.url();
    const errsBefore = page.__qa.pageErrors.length;
    const fiveBefore = page.__qa.serverErrors.length;
    try {
      const loc = page.locator(`[data-qa-sweep="${it.idx}"]`);
      if (!(await loc.count())) { continue; }
      if (it.tag === "SELECT") {
        const opts = await loc.locator("option").evaluateAll((os) => os.map((o) => o.value));
        if (opts.length > 1) { await loc.selectOption(opts[1]); await page.waitForTimeout(300); await loc.selectOption(opts[0]).catch(() => {}); }
      } else {
        await loc.click({ timeout: 3000 });
        await page.waitForTimeout(450);
      }
      tested.push(`${it.tag.toLowerCase()}:${it.name || "(select)"}`);
      if (page.__qa.pageErrors.length > errsBefore) problems.push(`page error after "${it.name}": ${page.__qa.pageErrors.at(-1)}`);
      if (page.__qa.serverErrors.length > fiveBefore) problems.push(`5xx after "${it.name}": ${page.__qa.serverErrors.at(-1)}`);
      if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape").catch(() => {});
      if (page.url() !== before) {
        // Let the new page finish starting up (its session refresh) before leaving it — cancelling
        // that request mid-flight signs the user out (NEW-1), which would corrupt later checks.
        await settle(page, 6000);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await settle(page, 6000);
        // Re-tag after navigation.
        await page.evaluate(() => 0);
        break; // the DOM is new — remaining tags are gone; stop rather than misreport
      }
    } catch (e) {
      // Element detached/obscured after an earlier click — not a product failure.
    }
  }
  return { tested, problems };
}

async function emptySubmit(page) {
  const forms = page.locator("main form");
  const n = await forms.count();
  if (!n) return null;
  const form = forms.first();
  const submit = form.locator('button[type="submit"], button:not([type])').last();
  if (!(await submit.count())) return null;
  const label = (await submit.innerText().catch(() => "")).trim();
  if (/pay|place order|delete|remove|refund|charge/i.test(label)) return { skipped: `submit "${label}" not exercised` };
  const target = form.locator("input[required]:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea[required]").first();
  const anyText = form.locator('input[type="text"], input[type="email"], input:not([type]), textarea').first();
  const field = (await target.count()) ? target : anyText;
  if (!(await field.count())) return { skipped: "no text field" };
  const prev = await field.inputValue().catch(() => "");
  await field.fill("").catch(() => {});
  const fiveBefore = page.__qa.serverErrors.length;
  await submit.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  const nativeInvalid = await field.evaluate((el) => !el.checkValidity()).catch(() => false);
  const shown = await page.locator('[role="alert"], .text-danger, [aria-invalid="true"]').count();
  await field.fill(prev).catch(() => {});
  const five = page.__qa.serverErrors.length > fiveBefore;
  return { submit: label, nativeInvalid, messages: shown, serverError: five };
}

// ---------------------------------------------------------------------------------------------
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const T = {};
  for (const k of Object.keys(CREDS)) T[k] = await login(CREDS[k]);
  const restaurantId = T.owner.user.restaurantId;
  const businessId = T.owner.user.businessId;

  // Seeded ids for parameterised routes.
  const ids = {};
  const ord = await api(T.owner.accessToken, `/restaurants/${restaurantId}/orders?page=1&limit=5`);
  ids.order = (ord.body?.data?.items ?? ord.body?.data?.orders ?? [])[0]?.id;
  const mine = await api(T.customer.accessToken, "/orders/mine?limit=5");
  ids.customerOrder = (mine.body?.data?.items ?? [])[0]?.id;
  const rt = await api(T.owner.accessToken, `/restaurants/${restaurantId}/support/tickets`);
  ids.restaurantTicket = (rt.body?.data?.tickets ?? rt.body?.data?.items ?? [])[0]?.id;
  const ct = await api(T.customer.accessToken, "/support/tickets/mine");
  ids.customerTicket = (ct.body?.data?.tickets ?? ct.body?.data?.items ?? [])[0]?.id;
  const at = await api(T.admin.accessToken, "/support/admin/tickets?limit=5");
  ids.adminTicket = (at.body?.data?.tickets ?? [])[0]?.id;
  const kb = await api(null, "/kb/articles");
  ids.kbSlug = (kb.body?.data?.articles ?? kb.body?.data?.items ?? [])[0]?.slug;
  const tables = await api(T.owner.accessToken, `/restaurants/${restaurantId}/tables`);
  const tbl = (tables.body?.data?.tables ?? tables.body?.data ?? [])[0];
  ids.tableToken = tbl?.qrToken ?? tbl?.token;
  if (!ids.tableToken && tbl?.id) {
    const qr = await api(T.owner.accessToken, `/restaurants/${restaurantId}/tables/${tbl.id}/qr`);
    ids.tableToken = qr.body?.data?.token ?? (qr.body?.data?.url || "").split("/t/")[1];
  }
  const promo = await api(T.owner.accessToken, `/restaurants/${restaurantId}/promotions`, { method: "POST", body: JSON.stringify({ code: "QAFIX10", name: "QA fix check", type: "percentage", value: 10 }) });
  ids.promo = promo.status;
  const printers = await api(T.owner.accessToken, `/restaurants/${restaurantId}/printers`);
  if (!(printers.body?.data?.printers ?? []).some((p) => p.purpose === "receipt" && p.isDefault)) {
    const pr = await api(T.owner.accessToken, `/restaurants/${restaurantId}/printers`, { method: "POST", body: JSON.stringify({ name: "QA receipt printer", purpose: "receipt", connectionType: "browser_print", isDefault: true, connectionConfig: {} }) });
    ids.printerCreate = pr.status;
  }
  const pj = await api(T.owner.accessToken, `/restaurants/${restaurantId}/print-jobs`, { method: "POST", body: JSON.stringify({ kind: "receipt", orderId: ids.order }) });
  ids.printJob = pj.body?.data?.printJob?.id;
  ids.printJobCreate = pj.status;
  const ij = await api(T.owner.accessToken, `/restaurants/${restaurantId}/menu/import-jobs`);
  ids.importJob = (ij.body?.data?.jobs ?? ij.body?.data?.items ?? [])[0]?.id;
  if (!ids.importJob) {
    const created = await api(T.owner.accessToken, `/restaurants/${restaurantId}/menu/import-jobs`, { method: "POST", body: JSON.stringify({ url: "https://example.com/menu" }) });
    ids.importJob = created.body?.data?.job?.id ?? created.body?.data?.id;
    ids.importJobCreate = created.status;
  }
  // POS is off for the demo location by default — switch it on (local test data only).
  const pos = await api(T.owner.accessToken, `/restaurants/${restaurantId}`, { method: "PATCH", body: JSON.stringify({ settings: { posEnabled: true } }) });
  ids.posEnable = pos.status;
  const co = await api(T.owner.accessToken, `/businesses/${businessId}/subscription/checkout`, { method: "POST", body: JSON.stringify({ planCode: "owner_growth", billingInterval: "monthly" }) });
  ids.checkoutStatus = co.status;
  const coUrl = co.body?.data?.url ?? co.body?.data?.checkout?.url ?? "";
  ids.mockToken = (coUrl.match(/mock-checkout\/([^?]+)/) || [])[1];
  console.log("ids", JSON.stringify({ ...ids, mockToken: ids.mockToken ? "set" : null }));

  // Role contexts (one sign-in each).
  const ctxs = {};
  const newCtx = (o = {}) => browser.newContext({ viewport: { width: 1440, height: 900 }, ...o });
  for (const role of ["admin", "owner", "manager", "staff", "kitchen"]) {
    ctxs[role] = await newCtx();
    const p = await ctxs[role].newPage();
    await adminLogin(p, CREDS[role]);
    await p.close();
  }
  ctxs.customer = await newCtx();
  { const p = await ctxs.customer.newPage(); await webLogin(p, CREDS.customer); await p.close(); }
  ctxs.anon = await newCtx();

  // Agency account, created through the real sign-up flow.
  ctxs.agency = await newCtx();
  {
    const p = await ctxs.agency.newPage();
    await p.goto(`${ADMIN}/register`, { waitUntil: "domcontentloaded" });
    await settle(p);
    await p.getByLabel("Full name").fill("QA Routes Agency");
    await p.getByLabel("Email").fill(AGENCY.email);
    await p.getByLabel("Password").fill(AGENCY.password);
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Create account" }).click();
    await p.waitForURL(/\/agency$/, { timeout: 20000 });
    await p.getByLabel("Agency name").fill(`QA Routes Agency ${stamp}`);
    await p.getByLabel("Slug").fill(`qa-routes-${stamp}`);
    await p.getByLabel("Contact email").fill(`qa-routes-contact-${stamp}@test.local`);
    await p.getByRole("button", { name: "Create agency" }).click();
    await p.getByText(`QA Routes Agency ${stamp}`).first().waitFor({ timeout: 15000 });
    await p.goto(`${ADMIN}/agency/businesses`, { waitUntil: "domcontentloaded" });
    await settle(p);
    await p.getByRole("button", { name: "New client" }).click();
    await p.getByLabel("Business name").fill(`QA Routes Client ${stamp}`);
    await p.getByLabel("Business slug").fill(`qa-routes-client-${stamp}`);
    await p.getByLabel("Owner full name").fill("Routes Client Owner");
    await p.getByLabel("Owner email").fill(`qa-routes-client-${stamp}@test.local`);
    await p.getByRole("button", { name: "Next" }).click();
    await p.getByLabel("First location name").fill(`QA Routes Location ${stamp}`);
    await p.getByLabel("Location slug").fill(`qa-routes-loc-${stamp}`);
    for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "Next" }).click();
    await p.getByRole("button", { name: "Create client" }).click();
    await p.waitForURL(/\/agency\/businesses\/[a-f0-9]+$/, { timeout: 20000 });
    ids.agencyBusiness = p.url().split("/").pop();
    await p.goto(`${ADMIN}/agency/locations`, { waitUntil: "domcontentloaded" });
    await settle(p);
    const href = await p.locator('a[href^="/agency/locations/"]').first().getAttribute("href").catch(() => null);
    ids.agencyLocation = href ? href.split("/").pop() : null;
    await p.close();
  }
  console.log("agency", ids.agencyBusiness ? "client created" : "no client", ids.agencyLocation ? "location found" : "no location");

  // ------------------------------------------------------------------------------------------
  // Route table. act(page) returns an observation; throwing = functional failure.
  // protect: "admin" (signed-out → /login) | "web" (signed-out → /login) | null.
  // deny: a role context that must NOT be able to use the page (redirected away).
  const R = [];
  const add = (app, route, url, role, act, opts = {}) => R.push({ app, route, url, role, act, ...opts });

  // ===== Marketing (16) — dev server for interactivity; status codes from the production build too.
  const mk = (route, url, act, opts) => add("marketing", route, MKT + url, "anon", act, opts);
  mk("/", "/", async (p) => { await p.getByRole("link", { name: /pricing/i }).first().click(); await p.waitForURL(/\/pricing/); return "nav → pricing"; });
  mk("/about", "/about", async (p) => { ok((await mainText(p)).length > 200, "thin"); return h1(p); });
  mk("/contact", "/contact", async (p) => {
    const submit = p.getByRole("button", { name: /send/i }).first();
    await submit.click(); await p.waitForTimeout(500);
    const invalid = await p.locator("form :invalid").count();
    ok(invalid > 0 || (await p.getByRole("alert").count()) > 0, "empty contact form not stopped");
    return `empty submit blocked (${invalid} invalid fields); not sent`;
  });
  mk("/demo", "/demo", async (p) => { const links = await p.locator('a[href*="5173"], iframe').count(); ok(links > 0, "no demo link/embed"); return `${links} demo links/embeds`; });
  mk("/faq", "/faq", async (p) => {
    const q = p.locator("main button[aria-expanded]").first(); await q.click(); ok((await q.getAttribute("aria-expanded")) === "true", "did not expand");
    const t = await mainText(p); ok(/customers pay you directly/i.test(t) || t.length > 300, "faq"); ok(!/Payments run through your own Stripe account/.test(t), "old Stripe claim");
    return "question expanded; payment answer accurate";
  });
  mk("/how-it-works", "/how-it-works", async (p) => { ok((await mainText(p)).length > 200, "thin"); return h1(p); });
  mk("/pricing", "/pricing", async (p) => {
    const t = await mainText(p); ok(/\$59|\$99|\$179/.test(t), "prices missing");
    const toggle = p.getByRole("button", { name: /yearly|annual/i }).first(); if (await toggle.count()) await toggle.click();
    ok(!/Card payments run on your own Stripe account/.test(t), "old Stripe claim");
    return "plans shown, interval toggle clicked";
  });
  mk("/privacy", "/privacy", async (p) => { ok(/privacy/i.test(await h1(p)), "h1"); return h1(p); });
  mk("/product", "/product", async (p) => { ok((await mainText(p)).length > 200, "thin"); return h1(p); });
  mk("/refund-policy", "/refund-policy", async (p) => { ok(/refund/i.test(await h1(p)), "h1"); return h1(p); });
  mk("/solutions", "/solutions", async (p) => { ok((await mainText(p)).length > 200, "thin"); return h1(p); });
  mk("/start-trial", "/start-trial", async (p) => { const l = await p.locator('a[href*="5174"]').count(); ok(l > 0, "no sign-up link"); return `${l} sign-up links`; });
  mk("/terms", "/terms", async (p) => { ok(/terms/i.test(await h1(p)), "h1"); return h1(p); });
  mk("/v2", "/v2", async (p) => {
    // Dev server still shows the draft (intended); the production build must not.
    const b = await p.context().newPage();
    await b.goto(`${MKTB}/v2`, { waitUntil: "networkidle" });
    const ph1 = await h1(b); await b.close();
    ok(/couldn't find that page/i.test(ph1), "production build still serves /v2: " + ph1);
    return `dev: draft (intended); production build: "${ph1}"`;
  }, { note: "QA-010" });
  mk("/v3", "/v3", async (p) => { ok(new URL(p.url()).pathname === "/", "no redirect"); return "→ /"; }, { expectPath: /^\/$/ });
  mk("*", "/no-such-page-qa", async (p) => {
    ok(/couldn't find/i.test(await h1(p)), "no 404 content");
    await p.getByRole("link", { name: /homepage/i }).first().click(); await p.waitForURL(/5175\/$/);
    return "404 page → homepage link works";
  });

  // ===== Storefront (26)
  const wb = (route, url, role, act, opts) => add("storefront", route, WEB + url, role, act, opts);
  wb("/", "/", "anon", async (p) => { ok(/\/r\/demo-restaurant$/.test(p.url()), "no redirect"); return "→ /r/demo-restaurant (VITE_RESTAURANT_SLUG)"; }, { expectPath: /^\/r\/demo-restaurant$/ });
  wb("/r/:restaurantSlug", "/r/demo-restaurant", "anon", async (p) => {
    const row = p.locator("li", { hasText: "Margherita Pizza" }).first(); await row.scrollIntoViewIfNeeded();
    await row.getByRole("button", { name: /Add to (order|cart)/ }).click();
    const d = p.getByRole("dialog"); await d.getByText("Medium").first().click();
    const btn = d.getByRole("button", { name: /Add to order — \$/ }); const label = await btn.innerText(); await btn.click();
    await p.getByRole("link", { name: /cart/i }).first().waitFor();
    return `added Margherita (Medium): "${label}"`;
  });
  wb("/r/:restaurantSlug/cart", "/r/demo-restaurant/cart", "customer", async (p) => {
    const t = await mainText(p);
    if (/cart is empty/i.test(t)) { await p.getByRole("button", { name: /browse the menu/i }).click(); await p.waitForURL(/\/r\/demo-restaurant$/); return "empty cart → browse works"; }
    await p.getByPlaceholder("Enter a code").fill("QAFIX10"); await p.getByRole("button", { name: "Apply" }).click();
    await waitText(p, /applied —/); await p.getByRole("button", { name: "Remove" }).last().click();
    return "promo applied and removed";
  });
  wb("/r/:restaurantSlug/experience", "/r/demo-restaurant/experience", "anon", async (p) => {
    const btns = p.getByRole("button"); ok((await btns.count()) > 2, "no controls"); await btns.nth(1).click(); return `${await btns.count()} controls; one clicked`;
  });
  wb("/r/:restaurantSlug/loyalty", "/r/demo-restaurant/loyalty", "customer", async (p) => { const t = await mainText(p); ok(/point|reward/i.test(t), "no loyalty content"); return t.slice(0, 80); }, { protect: "web" });
  wb("/r/:restaurantSlug/preview", "/r/demo-restaurant/preview", "customer", async (p) => { const t = await mainText(p); return t.slice(0, 100); }, { note: "owner-only preview; customer is refused" });
  wb("/r/:restaurantSlug/t/:tableToken", `/r/demo-restaurant/t/${ids.tableToken}`, "anon", async (p) => { ok(ids.tableToken, "no table token"); await waitText(p, /table/i); return "table banner shown"; });
  wb("/t/:tableToken", `/t/${ids.tableToken}`, "anon", async (p) => { ok(/\/r\/demo-restaurant\/t\//.test(p.url()), "no redirect"); return "→ /r/demo-restaurant/t/…"; }, { expectPath: /^\/r\/demo-restaurant\/t\// });
  wb("/cart", "/cart", "anon", async (p) => { ok(/\/r\/demo-restaurant\/cart$/.test(p.url()), "no redirect"); return "→ restaurant cart"; }, { expectPath: /cart$/ });
  wb("/loyalty", "/loyalty", "customer", async (p) => { ok(/loyalty/.test(p.url()), "url"); return p.url().replace(WEB, ""); }, { expectPath: /loyalty$/ });
  wb("/account", "/account", "customer", async (p) => {
    const name = p.getByLabel(/^name$/i).first(); const prev = await name.inputValue(); await name.fill(prev + " ");
    await name.fill(prev); return "profile form editable (not saved)";
  }, { protect: "web" });
  wb("/orders", "/orders", "customer", async (p) => {
    const link = p.locator('a[href^="/orders/"]').first(); ok(await link.count(), "no orders listed"); await link.click(); await p.waitForURL(/\/orders\/[a-f0-9]{24}$/); return "opened an order from the list";
  }, { protect: "web" });
  wb("/orders/:id", `/orders/${ids.customerOrder}`, "customer", async (p) => { const t = await mainText(p); ok(/ORD-/.test(t), "no order number"); return (t.match(/ORD-\d+/) || [""])[0]; }, { protect: "web" });
  wb("/orders/:id/receipt", `/orders/${ids.customerOrder}/receipt`, "customer", async (p) => { await p.addInitScript(() => { window.print = () => {}; }); const t = await p.locator("body").innerText(); ok(/ORD-|total/i.test(t), "no receipt"); return "receipt rendered"; }, { protect: "web", noLayout: true });
  wb("/support", "/support", "anon", async (p) => { const a = p.locator('a[href^="/support/articles/"]').first(); ok(await a.count(), "no articles"); await a.click(); await p.waitForURL(/\/support\/articles\//); return "opened an article"; });
  wb("/support/articles/:slug", `/support/articles/${ids.kbSlug}`, "anon", async (p) => { ok(ids.kbSlug, "no kb"); ok((await mainText(p)).length > 100, "thin article"); return h1(p); });
  wb("/support/tickets", "/support/tickets", "customer", async (p) => { const t = await mainText(p); return t.slice(0, 80); }, { protect: "web" });
  wb("/support/tickets/new", "/support/tickets/new", "customer", async (p) => {
    await p.getByRole("button", { name: /submit|send|create/i }).first().click(); await p.waitForTimeout(400);
    ok(new URL(p.url()).pathname === "/support/tickets/new", "empty form submitted");
    return "empty form stays on page (not submitted)";
  }, { protect: "web" });
  wb("/support/tickets/:id", `/support/tickets/${ids.customerTicket}`, "customer", async (p) => { ok(ids.customerTicket, "no ticket"); const t = await mainText(p); ok(t.length > 50, "thin"); return h1(p); }, { protect: "web" });
  wb("/login", "/login", "anon", async (p) => {
    await p.getByLabel("Email").fill("nobody@example.com"); await p.getByLabel("Password").fill("WrongPassword1!");
    await p.getByRole("button", { name: /^(Log in|Sign in)$/ }).click(); await p.getByRole("alert").first().waitFor({ timeout: 8000 });
    return await p.getByRole("alert").first().innerText();
  });
  wb("/register", "/register", "anon", async (p) => {
    await p.getByRole("button", { name: "Create account" }).click(); await p.waitForTimeout(300);
    ok(new URL(p.url()).pathname === "/register", "empty register submitted"); return "empty submit blocked";
  });
  wb("/forgot-password", "/forgot-password", "anon", async (p) => {
    await p.getByLabel("Email").fill("nobody-qa@example.com"); await p.getByRole("button", { name: /send|reset/i }).click();
    await waitText(p, /if an account|check your email|sent/i); return "same answer for unknown email";
  });
  wb("/reset-password", "/reset-password?token=invalid-qa-token", "anon", async (p) => {
    const pwds = p.locator('input[type="password"]'); await pwds.nth(0).fill("NewPassword123!"); if ((await pwds.count()) > 1) await pwds.nth(1).fill("NewPassword123!");
    await p.getByRole("button", { name: /reset|set|save|update/i }).first().click(); await p.getByRole("alert").first().waitFor({ timeout: 8000 });
    return "invalid token refused: " + (await p.getByRole("alert").first().innerText()).slice(0, 80);
  });
  wb("/verify-email", "/verify-email?token=invalid-qa-token", "anon", async (p) => { await waitText(p, /invalid|expired|couldn't|could not/i); return "invalid token message"; });
  wb("/confirm-email-change", "/confirm-email-change?token=invalid-qa-token", "anon", async (p) => { await waitText(p, /invalid|expired|couldn't|could not|sign in/i); return "invalid token handled"; });
  wb("*", "/no-such-storefront-page", "anon", async (p) => { ok(/not found/i.test(await h1(p)), "no 404"); await p.getByRole("button", { name: /back to home/i }).click(); return "404 → home"; });

  // ===== Admin (67)
  const ad = (route, url, role, act, opts = {}) => add("admin", route, ADMIN + url, role, act, { protect: "admin", ...opts });
  ad("/", "/", "owner", async (p) => { await p.locator("aside nav").getByRole("link", { name: "Orders" }).click(); await p.waitForURL(/\/orders$/); return "dashboard → Orders nav"; }, { deny: null });
  ad("/accept-agency-invite", "/accept-agency-invite?token=invalid-qa", "anon", async (p) => {
    const pwd = p.locator('input[type="password"]'); if (await pwd.count()) await pwd.first().fill("Password123!");
    await p.getByRole("button", { name: /accept/i }).first().click(); await p.getByRole("alert").first().waitFor({ timeout: 8000 });
    const msg = await p.getByRole("alert").first().innerText(); ok(!/^Validation failed$/.test(msg.trim()), "generic"); return "invalid token refused: " + msg.slice(0, 80);
  }, { protect: null });
  ad("/accept-invite", "/accept-invite?token=invalid-qa", "anon", async (p) => {
    const pwds = p.locator('input[type="password"]'); if (await pwds.count()) { await pwds.first().fill("Password123!"); if ((await pwds.count()) > 1) await pwds.nth(1).fill("Password123!"); await p.getByRole("button").last().click(); }
    await waitText(p, /invalid|expired|no longer|couldn't/i); return "invalid invite token refused";
  }, { protect: null });
  ad("/agency", "/agency", "agency", async (p) => { await waitText(p, new RegExp(`QA Routes Agency ${stamp}`)); return "agency overview"; }, { deny: "owner" });
  ad("/agency/activity", "/agency/activity", "agency", async (p) => { await p.getByRole("cell", { name: /Client created/ }).first().waitFor(); return "audit entry listed"; }, { deny: "owner" });
  ad("/agency/billing", "/agency/billing", "agency", async (p) => { ok(/billing/i.test(await h1(p)), "h1"); return h1(p); }, { deny: "owner" });
  ad("/agency/businesses", "/agency/businesses", "agency", async (p) => { await p.getByRole("button", { name: "New client" }).click(); await p.getByLabel("Business name").waitFor(); await p.keyboard.press("Escape"); return "new-client wizard opens"; }, { deny: "owner" });
  ad("/agency/businesses/:businessId", `/agency/businesses/${ids.agencyBusiness}`, "agency", async (p) => { await waitText(p, new RegExp(`QA Routes Client ${stamp}`)); return "client detail"; }, { deny: "owner" });
  ad("/agency/locations", "/agency/locations", "agency", async (p) => { ok(ids.agencyLocation, "no location link"); return "location listed"; }, { deny: "owner" });
  ad("/agency/locations/:locationId", `/agency/locations/${ids.agencyLocation}`, "agency", async (p) => { await waitText(p, new RegExp(`QA Routes Location ${stamp}`)); return "location detail"; }, { deny: "owner" });
  ad("/agency/members", "/agency/members", "agency", async (p) => { const t = await mainText(p); ok(/QA Routes Agency|owner/i.test(t), "no members"); return "members listed"; }, { deny: "owner" });
  ad("/agency/settings", "/agency/settings", "agency", async (p) => {
    await p.getByLabel("Description (optional)").fill("QA routes agency"); await p.getByRole("button", { name: "Save profile" }).click(); await waitText(p, /Saved\./); return "profile saved";
  }, { deny: "owner" });
  ad("/analytics", "/analytics", "owner", async (p) => { const sel = p.locator("select, [role=tab], button").filter({ hasText: /7|30|90|day|week|month/i }).first(); if (await sel.count()) await sel.click().catch(() => {}); ok((await mainText(p)).length > 100, "thin"); return "analytics + range control"; }, { deny: "kitchen" });
  ad("/audit-log", "/audit-log", "owner", async (p) => { await p.getByRole("cell").first().waitFor({ timeout: 10000 }); return "entries listed"; }, { deny: "staff" });
  ad("/billing", "/billing", "owner", async (p) => { ok(/billing|plan/i.test(await mainText(p)), "no billing content"); return h1(p); }, { deny: "staff" });
  ad("/business-analytics", "/business-analytics", "owner", async (p) => { ok((await mainText(p)).length > 80, "thin"); return h1(p); }, { deny: "kitchen" });
  ad("/business-promotions", "/business-promotions", "owner", async (p) => { ok((await mainText(p)).length > 50, "thin"); return h1(p); }, { deny: "kitchen" });
  ad("/customers", "/customers", "owner", async (p) => { const s = p.getByRole("searchbox").or(p.getByPlaceholder(/search/i)).first(); await s.fill("jordan"); await p.waitForTimeout(800); await waitText(p, /Jordan/i); return "search found Jordan"; }, { deny: "kitchen", note: "restaurant.customers.read: owner, manager, front-of-house staff (POS picker) and agency roles; kitchen refused" });
  ad("/delivery", "/delivery", "owner", async (p) => { ok(/delivery/i.test(await mainText(p)), "no delivery content"); return h1(p); }, { deny: "kitchen" });
  ad("/force-password-change", "/force-password-change", "owner", async (p) => { return `→ ${new URL(p.url()).pathname} (no forced change pending)`; }, { expectPath: /.*/ });
  ad("/forgot-password", "/forgot-password", "anon", async (p) => { await p.getByLabel(/email/i).fill("nobody-qa@example.com"); await p.getByRole("button", { name: /send|reset/i }).click(); await waitText(p, /if an account|check your email|sent/i); return "neutral confirmation"; }, { protect: null });
  ad("/kitchen", "/kitchen", "kitchen", async (p) => { ok(/kitchen|order|no active/i.test(await mainText(p)), "no kitchen board"); return h1(p); }, { deny: null });
  ad("/locations", "/locations", "owner", async (p) => { ok(/Wildwood|location/i.test(await mainText(p)), "no locations"); return h1(p); }, { deny: "staff" });
  ad("/login", "/login", "anon", async (p) => { await p.locator('input[type="email"]').fill("nobody@example.com"); await p.locator('input[type="password"]').fill("WrongPass123!"); await p.getByRole("button", { name: "Sign in" }).click(); await p.getByRole("alert").first().waitFor({ timeout: 8000 }); return await p.getByRole("alert").first().innerText(); }, { protect: null });
  ad("/loyalty", "/loyalty", "owner", async (p) => { ok(/loyalty|point|reward/i.test(await mainText(p)), "no loyalty"); return h1(p); }, { deny: "kitchen" });
  ad("/marketplace", "/marketplace", "owner", async (p) => { ok(/uber|doordash|foodpanda|marketplace/i.test(await mainText(p)), "no providers"); return h1(p); }, { deny: "kitchen" });
  ad("/marketplace/oauth-callback", "/marketplace/oauth-callback", "owner", async (p) => { await waitText(p, /missing|invalid|couldn't|could not|error|try again/i); return "no-code callback handled"; }, { expectPath: /.*/ });
  ad("/menu", "/menu", "owner", async (p) => { const item = p.getByText("Margherita Pizza").first(); await item.click(); await p.waitForTimeout(500); const drawer = await p.getByRole("dialog").count(); if (drawer) await p.keyboard.press("Escape"); return `item opened (${drawer ? "editor drawer" : "inline"})`; }, { deny: "kitchen" });
  ad("/menu/import", "/menu/import", "owner", async (p) => { ok(/import|photo|pdf|url|csv/i.test(await mainText(p)), "no import options"); return h1(p); }, { deny: "kitchen" });
  ad("/menu/import/csv", "/menu/import/csv", "owner", async (p) => { ok(/csv|template/i.test(await mainText(p)), "no csv content"); return h1(p); }, { deny: "kitchen" });
  ad("/menu/import/job/:jobId", `/menu/import/job/${ids.importJob}`, "owner", async (p) => { ok(ids.importJob, "no import job"); ok((await mainText(p)).length > 50, "thin"); return h1(p); }, { deny: "kitchen" });
  ad("/mock-checkout/:token", `/mock-checkout/${ids.mockToken}?ownerType=business`, "owner", async (p) => { ok(ids.mockToken, `no mock token (checkout ${ids.checkoutStatus})`); ok(/checkout|plan|pay|complete/i.test(await mainText(p)), "no checkout"); return h1(p); }, { protect: null, note: "public by design: the checkout token is the credential (mock billing only)" });
  ad("/orders", "/orders", "owner", async (p) => { const g = p.getByRole("group").first(); ok(await g.count(), "no order cards"); return `${await p.getByRole("group").count()} order groups`; }, { deny: null });
  ad("/platform", "/platform", "admin", async (p) => { await p.getByRole("link", { name: /restaurants/i }).first().click(); await p.waitForURL(/\/platform\/restaurants/); return "→ restaurants"; }, { deny: "owner" });
  ad("/platform/agencies", "/platform/agencies", "admin", async (p) => { await waitText(p, new RegExp(`QA Routes Agency ${stamp}`)); return "new agency listed"; }, { deny: "owner" });
  ad("/platform/analytics", "/platform/analytics", "admin", async (p) => { ok((await mainText(p)).length > 80, "thin"); return h1(p); }, { deny: "owner" });
  ad("/platform/refunds", "/platform/refunds", "admin", async (p) => { ok(/refund/i.test(await mainText(p)), "no refunds content"); return h1(p); }, { deny: "owner" });
  ad("/platform/restaurants", "/platform/restaurants", "admin", async (p) => { const s = p.getByRole("searchbox").or(p.getByPlaceholder(/search/i)).first(); await s.fill("Wildwood"); await p.waitForTimeout(800); await waitText(p, /Wildwood/); return "search → Wildwood"; }, { deny: "owner" });
  ad("/platform/restaurants/:id", `/platform/restaurants/${restaurantId}`, "admin", async (p) => { await waitText(p, /Wildwood/); return "detail"; }, { deny: "owner" });
  ad("/platform/restaurants/new", "/platform/restaurants/new", "admin", async (p) => { await p.getByRole("button", { name: /create/i }).last().click(); await p.waitForTimeout(400); ok(/\/new$/.test(p.url()), "empty create submitted"); return "empty create blocked"; }, { deny: "owner" });
  ad("/platform/settings", "/platform/settings", "admin", async (p) => { ok((await mainText(p)).length > 80, "thin"); return h1(p); }, { deny: "owner" });
  ad("/platform/subscriptions", "/platform/subscriptions", "admin", async (p) => { ok(/subscription|plan/i.test(await mainText(p)), "no subs"); return h1(p); }, { deny: "owner" });
  ad("/platform/support", "/platform/support", "admin", async (p) => { await p.locator('a[href^="/platform/support/tickets/"]').first().click(); await p.waitForURL(/\/platform\/support\/tickets\//); return "opened ticket"; }, { deny: "owner" });
  ad("/platform/support/kb", "/platform/support/kb", "admin", async (p) => { ok(/article|knowledge/i.test(await mainText(p)), "no kb"); return h1(p); }, { deny: "owner" });
  ad("/platform/support/tickets/:id", `/platform/support/tickets/${ids.adminTicket}`, "admin", async (p) => { ok(ids.adminTicket, "no ticket"); ok((await mainText(p)).length > 50, "thin"); return h1(p); }, { deny: "owner" });
  ad("/platform/users", "/platform/users", "admin", async (p) => { const s = p.getByRole("searchbox").or(p.getByPlaceholder(/search/i)).first(); await s.fill("owner@demo"); await p.waitForTimeout(800); await waitText(p, /owner@demo-restaurant\.local/); return "search found owner"; }, { deny: "owner" });
  ad("/pos", "/pos", "owner", async (p) => { ok((await p.locator("body").innerText()).length > 50, "thin"); return new URL(p.url()).pathname; }, { deny: "kitchen", noLayout: true });
  ad("/pos/customers", "/pos/customers", "owner", async (p) => { ok((await p.locator("body").innerText()).length > 50, "thin"); return "ok"; }, { deny: "kitchen", noLayout: true });
  ad("/pos/orders", "/pos/orders", "owner", async (p) => { ok((await p.locator("body").innerText()).length > 50, "thin"); return "ok"; }, { deny: "kitchen", noLayout: true });
  ad("/pos/pending", "/pos/pending", "owner", async (p) => { ok((await p.locator("body").innerText()).length > 30, "thin"); return "ok"; }, { deny: "kitchen", noLayout: true });
  ad("/pos/tables", "/pos/tables", "owner", async (p) => { ok((await p.locator("body").innerText()).length > 30, "thin"); return "ok"; }, { deny: "kitchen", noLayout: true });
  ad("/print/:mode/:id", `/print/receipt/${ids.order}`, "owner", async (p) => { const img = p.locator("img").first(); if (await img.count()) ok(await img.evaluate((e) => e.complete && e.naturalWidth > 0), "logo broken"); ok(/RECEIPT/.test(await p.locator("body").innerText()), "no receipt"); return "receipt + logo"; }, { noLayout: true, printStub: true });
  ad("/print/preview/:jobId", `/print/preview/${ids.printJob}`, "owner", async (p) => { ok(ids.printJob, "no print job"); ok((await p.locator("body").innerText()).length > 20, "empty"); return "preview rendered"; }, { noLayout: true, printStub: true });
  ad("/printers", "/printers", "owner", async (p) => { ok(/printer/i.test(await mainText(p)), "no printers"); return h1(p); }, { deny: "kitchen" });
  ad("/promotions", "/promotions", "owner", async (p) => { await waitText(p, /QAFIX10/); return "promotion listed"; }, { deny: "kitchen" });
  ad("/register", "/register", "anon", async (p) => {
    const btn = p.getByRole("button", { name: "Create account" });
    ok(await btn.isDisabled(), "submit enabled before terms accepted");
    await p.getByRole("checkbox").check(); ok(await btn.isEnabled(), "submit still disabled");
    await btn.click(); await p.waitForTimeout(400);
    const invalid = await p.locator("form :invalid").count();
    ok(/\/register$/.test(p.url()) && invalid > 0, "empty form went through");
    return `disabled until terms ticked; empty submit blocked (${invalid} invalid fields)`;
  }, { protect: null });
  ad("/reset-password", "/reset-password?token=invalid-qa", "anon", async (p) => { const pwds = p.locator('input[type="password"]'); await pwds.nth(0).fill("NewPassword123!"); if ((await pwds.count()) > 1) await pwds.nth(1).fill("NewPassword123!"); await p.getByRole("button").last().click(); await p.getByRole("alert").first().waitFor({ timeout: 8000 }); return (await p.getByRole("alert").first().innerText()).slice(0, 80); }, { protect: null, noLayout: true });
  ad("/settings", "/settings", "owner", async (p) => { for (const t of ["Location", "Ordering", "Payment", "Business Hours", "Branding", "Domain"]) { const b = p.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: t }); if (await b.count()) { await b.click(); await p.waitForTimeout(250); } } return "all tabs opened"; }, { deny: "staff" });
  ad("/setup", "/setup", "owner", async (p) => { ok(/setup|checklist|ready/i.test(await mainText(p)), "no checklist"); return h1(p); }, { deny: "kitchen" });
  ad("/signup", "/signup", "anon", async (p) => { const b = p.getByRole("button", { name: /next|continue|create/i }).first(); await b.click(); await p.waitForTimeout(400); ok(/\/signup/.test(p.url()), "left wizard on empty step"); return "empty step blocked"; }, { protect: null, noLayout: true });
  ad("/staff", "/staff", "owner", async (p) => {
    await waitText(p, /manager@demo-restaurant\.local|kitchen@demo/);
    // NEW-3: choosing another role asks first; cancelling saves nothing (seed data untouched).
    const role = p.getByLabel("Role for Jamie Park");
    const before = await role.inputValue();
    await role.selectOption(before === "kitchen_staff" ? "restaurant_staff" : "kitchen_staff");
    const dlg = p.getByRole("alertdialog");
    await dlg.getByText(/permissions change as soon as you confirm/).waitFor({ timeout: 8000 });
    await dlg.getByRole("button", { name: "Cancel" }).click();
    ok((await role.inputValue()) === before, "role changed after cancel");
    return "team listed; role-change confirmation shown and cancelled";
  }, { deny: "kitchen" });
  ad("/start", "/start", "anon", async (p) => { ok((await p.locator("body").innerText()).length > 50, "thin"); return new URL(p.url()).pathname; }, { protect: null, noLayout: true, expectPath: /.*/ });
  ad("/support", "/support", "owner", async (p) => { ok(/support|ticket/i.test(await mainText(p)), "no support"); return h1(p); }, { deny: null });
  ad("/support/:id", `/support/${ids.restaurantTicket}`, "owner", async (p) => { ok(ids.restaurantTicket, "no ticket"); ok((await mainText(p)).length > 50, "thin"); return h1(p); }, { deny: null });
  ad("/tables", "/tables", "owner", async (p) => { const b = p.getByRole("button", { name: /qr/i }).first(); if (await b.count()) { await b.click(); await p.getByRole("img", { name: /QR code/ }).waitFor({ timeout: 8000 }); return "QR shown"; } return h1(p); }, { deny: "kitchen" });
  ad("/theme-studio", "/theme-studio", "owner", async (p) => { ok(/theme/i.test(await mainText(p)), "no themes"); return h1(p); }, { deny: "kitchen" });
  ad("/verify-email", "/verify-email?token=invalid-qa", "anon", async (p) => { await waitText(p, /invalid|expired|couldn't|could not/i); return "invalid token message"; }, { protect: null, noLayout: true });

  const counts = R.reduce((a, r) => ((a[r.app] = (a[r.app] || 0) + 1), a), {});
  console.log("routes", JSON.stringify(counts), R.length);

  // ------------------------------------------------------------------------------------------
  const results = [];
  for (const r of R) {
    if (ONLY && !ONLY.test(r.route)) continue;
    if (APPF && r.app !== APPF) continue;
    const rec = { app: r.app, route: r.route, url: r.url.replace(/^http:\/\/localhost:\d+/, ""), role: r.role, checks: {}, notes: [] };
    // Signed-out routes get a brand-new context each time: the demo playground signs a context in as
    // a "Demo Guest", which must not leak into later signed-out checks.
    const freshAnon = r.role === "anon" ? await newCtx() : null;
    const ctx = freshAnon ?? ctxs[r.role];
    const page = await ctx.newPage();
    page.__qa = { consoleErrors: [], pageErrors: [], serverErrors: [], clientErrors: [] };
    page.on("console", (m) => m.type() === "error" && page.__qa.consoleErrors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => page.__qa.pageErrors.push(e.message.slice(0, 200)));
    page.on("response", (res) => {
      const u = res.url();
      if (res.status() >= 500) page.__qa.serverErrors.push(`${res.status()} ${u.replace(/^http:\/\/localhost:\d+/, "")}`);
      else if (res.status() >= 400 && /\/api\//.test(u)) page.__qa.clientErrors.push(`${res.status()} ${res.request().method()} ${u.replace(/^http:\/\/localhost:\d+/, "")}`);
    });
    if (r.printStub) await page.addInitScript(() => { window.print = () => {}; });
    const shot = path.join(OUT, `${r.app}-${r.route.replace(/[^a-z0-9]+/gi, "_")}-${r.role}.png`);
    try {
      // A) direct load + rendering
      const resp = await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await settle(page);
      await page.waitForTimeout(300);
      const finalPath = new URL(page.url()).pathname;
      rec.finalPath = finalPath;
      const expectPath = r.expectPath ?? new RegExp("^" + new URL(r.url).pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
      rec.checks.directLoad = (resp ? resp.status() < 400 : true) && expectPath.test(finalPath) ? "PASS" : `FAIL (status ${resp?.status()}, landed on ${finalPath})`;
      const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      rec.h1 = await h1(page);
      const crashed = /something went wrong|unexpected application error/i.test(body);
      rec.checks.rendering = body.length > 30 && !crashed ? "PASS" : `FAIL (${crashed ? "error boundary" : "almost empty"})`;
      await page.screenshot({ path: shot }).catch(() => {});
      rec.evidence = path.basename(shot);
      // B) functional test
      if (r.act) {
        try { rec.functional = String(await r.act(page)).slice(0, 200); rec.checks.functional = "PASS"; }
        catch (e) { rec.checks.functional = "FAIL"; rec.functionalError = String(e.message).split("\n")[0].slice(0, 220); await page.screenshot({ path: shot.replace(".png", "-fail.png") }).catch(() => {}); }
      }
      // C) controls sweep + D) empty submit — on a fresh load
      await page.goto(r.url, { waitUntil: "domcontentloaded" });
      await settle(page, 6000);
      const sw = await sweep(page, r.url);
      rec.controlsTested = sw.tested;
      rec.checks.controls = sw.problems.length ? `FAIL (${sw.problems.join("; ").slice(0, 200)})` : `PASS (${sw.tested.length} safe controls)`;
      await page.goto(r.url, { waitUntil: "domcontentloaded" });
      await settle(page, 6000);
      const fs1 = await emptySubmit(page).catch((e) => ({ error: e.message }));
      if (fs1) rec.formInvalid = fs1;
      rec.checks.forms = !fs1 ? "N/A (no form)" : fs1.skipped ? `N/A (${fs1.skipped})` : fs1.serverError ? "FAIL (5xx on empty submit)" : fs1.nativeInvalid || fs1.messages ? "PASS (blocked with message)" : "REVIEW (no visible validation)";
      // E) refresh
      await page.goto(r.url, { waitUntil: "domcontentloaded" });
      await settle(page, 6000);
      const p1 = new URL(page.url()).pathname;
      await page.reload({ waitUntil: "domcontentloaded" });
      await settle(page, 6000);
      rec.checks.refresh = new URL(page.url()).pathname === p1 && (await page.locator("body").innerText()).length > 30 ? "PASS" : `FAIL (${new URL(page.url()).pathname})`;
      // F) Back / Forward
      const home = r.app === "marketing" ? (r.url.endsWith("/about") ? MKT + "/faq" : MKT + "/about") : r.app === "storefront" ? (r.url.endsWith("/support") ? WEB + "/login" : WEB + "/support") : ADMIN + "/login";
      if (r.role !== "anon" && r.app === "admin") {
        // signed-in admin: use a page every role can open
      }
      const neutralAdmin = r.role === "anon" ? (r.url.includes("/login") ? ADMIN + "/forgot-password" : ADMIN + "/login") : r.role === "agency" ? (/\/agency$/.test(r.url) ? ADMIN + "/agency/settings" : ADMIN + "/agency") : r.url.endsWith("/support") ? ADMIN + "/settings" : r.role === "admin" ? (r.url.endsWith("/platform/users") ? ADMIN + "/platform" : ADMIN + "/platform/users") : ADMIN + "/support";
      const neutral = r.app === "admin" ? neutralAdmin : home;
      await page.goto(neutral, { waitUntil: "domcontentloaded" });
      await settle(page, 5000);
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await settle(page, 5000);
      const backOk = new URL(page.url()).pathname === p1;
      await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
      await settle(page, 6000);
      const fwdOk = new URL(page.url()).href.startsWith(neutral.split("?")[0]);
      if (!fwdOk) rec.notes.push(`forward landed on ${new URL(page.url()).pathname}`);
      rec.checks.backForward = backOk ? "PASS" : `FAIL (back landed on ${new URL(page.url()).pathname})`;
      // G) mobile
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(r.url, { waitUntil: "domcontentloaded" });
      await settle(page, 6000);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: shot.replace(".png", "-390.png") }).catch(() => {});
      rec.checks.mobile390 = overflow <= 1 ? "PASS" : `FAIL (page ${overflow}px wider than screen)`;
      await page.setViewportSize({ width: 1440, height: 900 });
    } catch (e) {
      rec.fatal = String(e.message).split("\n")[0].slice(0, 220);
    }
    // H) access
    if (r.protect) {
      const anonCtx = await newCtx();
      const ap = await anonCtx.newPage();
      await ap.goto(r.url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await settle(ap, 6000);
      const landed = new URL(ap.url()).pathname;
      rec.checks.signedOutDenied = /\/login$/.test(landed) ? "PASS" : `FAIL (signed-out landed on ${landed})`;
      await anonCtx.close();
    }
    if (r.deny) {
      const dp = await ctxs[r.deny].newPage();
      await dp.goto(r.url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await settle(dp, 6000);
      const landed = new URL(dp.url()).pathname;
      rec.checks.wrongRoleDenied = landed !== new URL(r.url).pathname ? `PASS (${r.deny} → ${landed})` : `FAIL (${r.deny} stayed on page)`;
      await dp.close();
    }
    if (r.role !== "anon") {
      const sp = await ctx.newPage();
      await sp.goto(r.app === "storefront" ? WEB + "/account" : ADMIN + (r.role === "agency" ? "/agency" : r.role === "admin" ? "/platform" : "/support"), { waitUntil: "domcontentloaded" }).catch(() => {});
      await settle(sp, 6000);
      rec.sessionAfter = /\/login$/.test(new URL(sp.url()).pathname) ? "LOST" : "ok";
      await sp.close();
      if (rec.sessionAfter === "LOST") {
        const lp = await ctx.newPage();
        if (r.app === "storefront") await webLogin(lp, CREDS[r.role]); else await adminLogin(lp, r.role === "agency" ? [AGENCY.email, AGENCY.password] : CREDS[r.role]);
        await lp.close();
      }
    }
    rec.consoleErrors = [...new Set(page.__qa.consoleErrors)];
    rec.pageErrors = [...new Set(page.__qa.pageErrors)];
    rec.serverErrors = [...new Set(page.__qa.serverErrors)];
    rec.apiClientErrors = [...new Set(page.__qa.clientErrors)];
    rec.checks.consoleNetwork = rec.pageErrors.length || rec.serverErrors.length ? `FAIL (${[...rec.pageErrors, ...rec.serverErrors].join("; ").slice(0, 200)})` : rec.apiClientErrors.length || rec.consoleErrors.length ? `REVIEW (${rec.apiClientErrors.length} API 4xx, ${rec.consoleErrors.length} console errors)` : "PASS";
    const vals = Object.values(rec.checks);
    rec.status = rec.fatal ? "FAIL" : vals.some((v) => v.startsWith("FAIL")) ? "FAIL" : r.act && rec.checks.functional === "PASS" ? "PASS" : "NOT TESTED";
    await page.close();
    if (freshAnon) await freshAnon.close();
    results.push(rec);
    console.log(`${rec.sessionAfter === "LOST" ? "[SESSION LOST] " : ""}${rec.status.padEnd(10)} ${r.app.padEnd(10)} ${r.route.padEnd(36)} ${r.role.padEnd(8)} ${Object.entries(rec.checks).filter(([, v]) => !v.startsWith("PASS") && !v.startsWith("N/A")).map(([k, v]) => `${k}=${v}`).join(" | ").slice(0, 260)}${rec.functionalError ? " | fn: " + rec.functionalError : ""}${rec.fatal ? " | FATAL " + rec.fatal : ""}`);
  }
  fs.writeFileSync(path.join(OUT, ONLY || APPF ? "results-partial.json" : "results.json"), JSON.stringify({ ids: { ...ids, mockToken: ids.mockToken ? "set" : null }, counts, results }, null, 2));
  const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log("TALLY", JSON.stringify(tally));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
