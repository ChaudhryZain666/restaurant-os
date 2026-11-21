// Step runner for interactive QA journeys: each step is recorded PASS/FAIL with evidence.
const fs = require("fs");
const path = require("path");

function journey(name, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const steps = [];
  const consoleErrors = [];
  const failedRequests = [];
  let n = 0;
  return {
    steps,
    consoleErrors,
    failedRequests,
    watch(page) {
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 250)}`));
      page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${page.url()} :: ${String(e.message).slice(0, 250)}`));
      page.on("response", (r) => {
        if (r.status() >= 500 || (r.status() >= 400 && /\/api\//.test(r.url()))) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 150)}`);
      });
    },
    /** Runs fn; PASS if it returns without throwing (a returned string is recorded as the observation). */
    async step(page, label, fn, { shot = true } = {}) {
      n += 1;
      const id = `${name}-${String(n).padStart(2, "0")}`;
      const rec = { id, label };
      try {
        const obs = await fn();
        rec.result = "PASS";
        if (obs !== undefined) rec.observed = obs;
      } catch (e) {
        rec.result = "FAIL";
        rec.error = String(e.message || e).split("\n").slice(0, 4).join(" | ").slice(0, 500);
        rec.aria = await page.locator("body").ariaSnapshot().catch(() => "").then((s) => s.slice(0, 2500));
      }
      rec.url = page.url();
      if (shot || rec.result === "FAIL") {
        rec.shot = path.join(outDir, `${id}.png`);
        await page.screenshot({ path: rec.shot }).catch(() => delete rec.shot);
      }
      steps.push(rec);
      console.log(`${rec.result} ${id} ${label}${rec.observed ? " — " + JSON.stringify(rec.observed).slice(0, 160) : ""}${rec.error ? " — " + rec.error.slice(0, 200) : ""}`);
      return rec.result === "PASS";
    },
    /** A finding that isn't a step failure (e.g. odd wording), with evidence. */
    note(page, text) {
      steps.push({ id: `${name}-note`, label: text, result: "NOTE", url: page.url() });
      console.log(`NOTE ${text}`);
    },
  };
}

const money = (s) => {
  const m = String(s).replace(/,/g, "").match(/-?\$?\s?(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : NaN;
};

module.exports = { journey, money };
