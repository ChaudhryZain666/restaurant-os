const { chromium } = require("D:/restaurant-os-white-label/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  for (const [vp, size] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: size });
    const errs = [];
    p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.goto("http://localhost:5177/v2", { waitUntil: "networkidle" });
    const h1 = await p.getByRole("heading", { level: 1 }).first().innerText();
    const robots = await p.locator('meta[name="robots"]').getAttribute("content").catch(() => null);
    const title = await p.title();
    await p.screenshot({ path: `out/verify-fixes/qa010-v2-${vp}.png` });
    await p.goto("http://localhost:5177/", { waitUntil: "networkidle" });
    const home = await p.locator("body").innerText();
    console.log(JSON.stringify({ vp, v2_h1: h1, title, robots, homeOk: home.length > 500, stripeClaim: /Checked out on your own Stripe/.test(home), errs }));
    await p.close();
  }
  await b.close();
})();
