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
