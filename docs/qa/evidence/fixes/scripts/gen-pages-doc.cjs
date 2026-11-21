// Builds docs/qa/full-browser-all-pages-verification.md from out/routes-all/results.json
// (plus results-rerun.json for routes re-run after correcting a test expectation).
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "out", "routes-all");
const main = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
const rerunFile = path.join(OUT, "results-rerun.json");
const rerun = fs.existsSync(rerunFile) ? JSON.parse(fs.readFileSync(rerunFile, "utf8")).results : [];
const key = (r) => `${r.app}|${r.route}`;
const rerunMap = new Map(rerun.map((r) => [key(r), r]));
const results = main.results.map((r) => (rerunMap.has(key(r)) ? { ...rerunMap.get(key(r)), rerun: true, firstRun: r.status } : r));
const DEFECTS = JSON.parse(fs.readFileSync(path.join(__dirname, "defect-map.json"), "utf8"));

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const short = (v) => (v ? v.replace(/^PASS \((.*)\)$/, "PASS — $1").replace(/^N\/A \((.*)\)$/, "N/A — $1") : "—");
const roleName = { anon: "signed out", customer: "customer (Jordan)", owner: "owner", manager: "manager", staff: "staff", kitchen: "kitchen", admin: "platform admin", agency: "agency owner (created)" };

const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
const byApp = {};
for (const r of results) {
  byApp[r.app] ??= { total: 0 };
  byApp[r.app].total++;
  byApp[r.app][r.status] = (byApp[r.app][r.status] || 0) + 1;
}

let md = `# GarnishTable — Every Route, Verified After the Fixes

Branch \`fix/full-browser-qa-findings\`, local stack. Run on the isolated \`restaurant_platform_e2e\` database with mock providers. Companion to [\`full-browser-qa-fixes.md\`](full-browser-qa-fixes.md).

## How each route was tested

Each route was opened by URL, in its own page, as the role it is meant for. Automated by \`routes-all.cjs\` (Playwright, Chromium). For every route:

1. **Direct load.** HTTP status, the page lands where it should, no error boundary, real content.
2. **Functional test.** A check written for that route: a form submitted valid or invalid, a search, a tab, a dialog, a navigation, or a token page given a bad token.
3. **Controls sweep.** Up to 18 visible controls in the page body clicked (links, tabs, non-submitting buttons, selects), checking for page errors and 5xx after each. Destructive or data-changing controls (delete, pay, send, save, publish…) are skipped, so the forms are covered by steps 2 and 4 instead.
4. **Empty-form submit.** For a page with a form: clear a required field, submit, and record whether it was blocked with a message and whether anything returned a 5xx.
5. **Refresh.** Same page, still content.
6. **Back/Forward.** Through another page and back.
7. **390px.** The page reloaded at phone width; FAIL if the page itself scrolls sideways.
8. **Access.** A signed-out browser must land on \`/login\` for protected pages. A wrong role, where one applies, must be sent elsewhere.
9. **Console and network.** Page errors and 5xx are FAIL. API 4xx and console errors are listed for review; most are expected refusals the test itself provoked.

**Status:** PASS only when the functional test passed **and** no check failed. FAIL when any check failed. NOT TESTED when nothing functional was run.

**Production:** not touched. The fixes aren't deployed.

## Totals

| | Routes | PASS | FAIL | BLOCKED | NOT TESTED |
|---|---|---|---|---|---|
`;
for (const app of ["marketing", "storefront", "admin"]) {
  const b = byApp[app] || { total: 0 };
  md += `| ${app} | ${b.total} | ${b.PASS || 0} | ${b.FAIL || 0} | ${b.BLOCKED || 0} | ${b["NOT TESTED"] || 0} |\n`;
}
md += `| **all** | **${results.length}** | **${tally.PASS || 0}** | **${tally.FAIL || 0}** | **${tally.BLOCKED || 0}** | **${tally["NOT TESTED"] || 0}** |\n\n`;

const lost = results.filter((r) => r.sessionAfter === "LOST");
md += `Signed-in sessions lost during the run: ${lost.length}${lost.length ? ` (${lost.map((r) => r.route).join(", ")}). See NEW-1 in the fixes report` : ""}.\n\n`;
const reruns = results.filter((r) => r.rerun);
if (reruns.length) {
  md += `**Re-run after correcting the test, not the product (${reruns.length}):** ${reruns.map((r) => `\`${r.route}\` (first run ${r.firstRun})`).join(", ")}. The reason is in each route's notes.\n\n`;
}

let n = 0;
for (const app of ["marketing", "storefront", "admin"]) {
  md += `## ${app[0].toUpperCase() + app.slice(1)} (${byApp[app]?.total || 0})\n\n`;
  for (const r of results.filter((x) => x.app === app)) {
    n++;
    const id = `R-${String(n).padStart(3, "0")}`;
    const c = r.checks || {};
    const cons = r.consoleErrors?.length || r.apiClientErrors?.length
      ? `${short(c.consoleNetwork)}. API: ${[...new Set(r.apiClientErrors || [])].slice(0, 4).join(", ") || "none"}`
      : short(c.consoleNetwork);
    const defect = DEFECTS[`${app}|${r.route}`] || (r.status === "FAIL" ? "see notes" : "—");
    md += `### ${id} · \`${r.route}\` — **${r.status}**\n\n`;
    md += `| | |\n|---|---|\n`;
    md += `| URL / role | \`${esc(r.url)}\` · ${roleName[r.role] || r.role} |\n`;
    md += `| Direct load | ${esc(short(c.directLoad))}${r.finalPath && r.finalPath !== r.url.split("?")[0] ? ` (landed on \`${r.finalPath}\`)` : ""} |\n`;
    md += `| Rendering | ${esc(short(c.rendering))} — h1 "${esc(r.h1)}" |\n`;
    md += `| Functional test | ${esc(short(c.functional))}${r.functional ? `: ${esc(r.functional)}` : ""}${r.functionalError ? ` — ${esc(r.functionalError)}` : ""} |\n`;
    md += `| Controls tested | ${esc(short(c.controls))}${r.controlsTested?.length ? `: ${esc(r.controlsTested.slice(0, 10).join(", "))}${r.controlsTested.length > 10 ? "…" : ""}` : ""} |\n`;
    md += `| Form (empty submit) | ${esc(short(c.forms))}${r.formInvalid && !r.formInvalid.skipped ? ` (submit "${esc(r.formInvalid.submit)}", native-invalid ${r.formInvalid.nativeInvalid}, messages ${r.formInvalid.messages})` : ""} |\n`;
    md += `| Refresh | ${esc(short(c.refresh))} |\n| Back/Forward | ${esc(short(c.backForward))} |\n| 390px | ${esc(short(c.mobile390))} |\n`;
    md += `| Access | signed-out: ${esc(short(c.signedOutDenied))}; wrong role: ${esc(short(c.wrongRoleDenied))} |\n`;
    md += `| Console / network | ${esc(cons)} |\n`;
    md += `| Evidence | \`${esc(r.evidence || "—")}\` (+ \`-390.png\`) |\n`;
    md += `| Defect | ${esc(defect)} |\n`;
    const notes = [...(r.notes || []), ...(r.fatal ? [`fatal: ${r.fatal}`] : []), ...(r.rerun ? [`re-run (first run ${r.firstRun})`] : [])];
    if (DEFECTS[`note|${app}|${r.route}`]) notes.push(DEFECTS[`note|${app}|${r.route}`]);
    if (notes.length) md += `| Notes | ${esc(notes.join("; "))} |\n`;
    md += `\n`;
  }
}
fs.writeFileSync("D:/restaurant-os-white-label/docs/qa/full-browser-all-pages-verification.md", md);
console.log("written", results.length, JSON.stringify(tally));
