// SEO prerendering (src/seo/pages.ts) — source-level checks that the static HTML can never
// disagree with the running app, and that nginx serves each prerendered file under its page's URL.
// The built output itself is checked by infrastructure/production/test/marketing-legal-build-test.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pagesSrc = readFileSync(join(here, "src/seo/pages.ts"), "utf8");
const nginx = readFileSync(join(here, "../../infrastructure/docker/nginx/marketing.locations.template"), "utf8");

// { path, file, title, description } for each SEO_PAGES entry (descriptions may wrap onto a new line).
const entries = [
  ...pagesSrc.matchAll(/path: "([^"]+)",\s*file: "([^"]+)",\s*title: "([^"]+)",\s*description:\s*"([^"]+)"/g),
].map(([, path, file, title, description]) => ({ path, file, title, description }));

const PAGE_COMPONENT = {
  "/": "HomeV3Page",
  "/product": "ProductPage",
  "/solutions": "SolutionsPage",
  "/how-it-works": "HowItWorksPage",
  "/pricing": "PricingPage",
  "/faq": "FaqPage",
  "/demo": "DemoPage",
  "/about": "AboutPage",
  "/contact": "ContactPage",
  "/start-trial": "StartTrialPage",
};

test("every indexable marketing page is prerendered", () => {
  assert.deepEqual(entries.map((e) => e.path).sort(), Object.keys(PAGE_COMPONENT).sort());
});

test("each prerendered title and description equals the page's own usePageMeta", () => {
  for (const e of entries) {
    const component = readFileSync(join(here, `src/pages/${PAGE_COMPONENT[e.path]}.tsx`), "utf8").replace(/\s+/g, " ");
    assert.ok(component.includes(`title: "${e.title}"`), `${e.path}: title differs from ${PAGE_COMPONENT[e.path]}`);
    assert.ok(component.includes(`"${e.description}"`), `${e.path}: description differs from ${PAGE_COMPONENT[e.path]}`);
  }
});

test("nginx serves each page's prerendered file under its own URL, falling back to the shell", () => {
  assert.match(nginx, /location = \/ \{\s*try_files \/_pages\/home\.html \/index\.html =404;/);
  assert.match(nginx, /try_files \/_pages\/\$1\.html \/index\.html =404;/);
  const routes = /location ~\* \^\/\(([^)]+)\)\/\?\$ \{\s*try_files \/_pages\/\$1\.html/.exec(nginx)?.[1].split("|") ?? [];
  for (const e of entries.filter((x) => x.path !== "/")) {
    assert.ok(routes.includes(e.file), `${e.path} (${e.file}.html) is not served by the prerender location`);
    assert.equal(`/${e.file}`, e.path, `${e.path}: file name must equal the URL segment nginx captures`);
  }
  assert.match(nginx, /location \^~ \/_pages\/ \{\s*return 404;/, "the files are never reachable at /_pages/");
});

test("the prerendered body states only shipped facts (no online-payment or marketplace promises)", () => {
  assert.doesNotMatch(pagesSrc, /accept card payments online|pay online by card|Uber Eats integration|DoorDash integration/i);
});

// Comparison pages (src/lib/comparisons.ts): every one is routed, served by nginx, in the sitemap,
// and carries its sources and check date; Toast stays out until its facts are verified.
const comparisonsSrc = readFileSync(join(here, "src/lib/comparisons.ts"), "utf8");
const appSrc = readFileSync(join(here, "src/App.tsx"), "utf8");
const sitemapSrc = readFileSync(join(here, "public/sitemap.xml"), "utf8");
const slugs = [...comparisonsSrc.matchAll(/^\s{4}slug: "([^"]+)"/gm)].map((m) => m[1]);

test("each comparison page is routed, served by nginx and listed in the sitemap", () => {
  assert.deepEqual(slugs.sort(), ["chownow", "restolabs"]);
  for (const s of slugs) {
    assert.ok(appSrc.includes(`<Route path="/compare/${s}"`), `/compare/${s} is not routed`);
    assert.match(nginx, new RegExp(`\|compare/${s}[|)]`), `/compare/${s} is not served by nginx`);
    assert.ok(sitemapSrc.includes(`/compare/${s}</loc>`), `/compare/${s} is not in the sitemap`);
  }
});

test("every comparison cites its sources and the date the facts were checked", () => {
  const blocks = comparisonsSrc.split(/\n  \{\n    slug: /).slice(1);
  assert.equal(blocks.length, slugs.length);
  for (const b of blocks) {
    assert.match(b, /checkedOn: "\d{1,2} \w+ \d{4}"/);
    assert.match(b, /sources: \[\s*\{ label: "[^"]+", url: "https:\/\//);
    assert.match(b, /chooseCompetitor: \[/, "each comparison says when the competitor is the better fit");
  }
  assert.doesNotMatch(comparisonsSrc, /slug: "toast"/, "Toast stays out until its facts are verified");
});
