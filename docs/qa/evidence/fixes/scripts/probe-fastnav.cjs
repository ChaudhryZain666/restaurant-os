// Can fast navigation (a page load cancelled while its /auth/refresh is in flight) sign a user out?
const fs = require("fs");
const { chromium } = require("D:/restaurant-os-white-label/node_modules/playwright");
const seed = fs.readFileSync("D:/restaurant-os-white-label/apps/api/src/scripts/seed-demo-data.ts", "utf8");
const pw = seed.match(/bcrypt\.hash\("(Customer[^"]*)"/)[1];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto("http://localhost:5173/login");
  await p.getByLabel("Email").fill("priya.patel@example.com");
  await p.getByLabel("Password").fill(pw);
  await p.getByRole("button", { name: /^(Log in|Sign in)$/ }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  const statuses = [];
  p.on("response", (r) => r.url().includes("/auth/refresh") && statuses.push(r.status()));
  let lostAt = null;
  for (let i = 1; i <= 15 && !lostAt; i++) {
    // Start a load, then cancel it as soon as its refresh request is on the wire.
    const sent = p.waitForRequest((r) => r.url().includes("/auth/refresh"), { timeout: 15000 });
    p.goto("http://localhost:5173/orders").catch(() => {});
    await sent;
    await p.goto("http://localhost:5173/account", { waitUntil: "domcontentloaded" });
    await p.waitForLoadState("networkidle").catch(() => {});
    if (/\/login$/.test(new URL(p.url()).pathname)) lostAt = i;
  }
  console.log(JSON.stringify({ lostAt, refreshStatuses: statuses }));
  await b.close();
})();
