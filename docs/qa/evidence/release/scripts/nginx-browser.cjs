const { chromium } = require("D:/restaurant-os-white-label/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const out = [];
  for (const [url, expect] of [
    ["http://localhost:8081/no-such-page", /couldn't find that page/i],
    ["http://localhost:8081/v2", /couldn't find that page/i],
    ["http://localhost:8081/pricing", /\$59|\$99|\$179/],
    ["http://localhost:8082/r/demo-restaurant", /Margherita/],
    ["http://localhost:8082/", /Open your restaurant's ordering link/],
    ["http://localhost:8083/login", /sign in/i],
  ]) {
    const res = await p.goto(url, { waitUntil: "networkidle" });
    const text = await p.locator("body").innerText();
    out.push(`${expect.test(text) ? "PASS" : "FAIL"} ${res.status()} ${url}`);
  }
  console.log(out.join("\n"), "\npage errors:", errs.length);
  await b.close();
})();
