import { siteStructuredData, type SeoPage } from "./pages.js";

/**
 * Build-time only (vite.config.ts → prerenderPages; never bundled into the app). Turns the built
 * dist/index.html into one page's static HTML: its own title, description, canonical URL and
 * Open Graph/Twitter tags, its structured data, and readable content inside #root that React
 * replaces when the app mounts (createRoot clears the container on first render).
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON inside <script> must not be able to close the tag. */
const jsonForScript = (data: object) => JSON.stringify(data).replace(/</g, "\\u003c");

const NAV: [string, string][] = [
  ["/", "Home"],
  ["/product", "Product"],
  ["/pricing", "Pricing"],
  ["/how-it-works", "How it works"],
  ["/demo", "Live demo"],
  ["/faq", "FAQ"],
  ["/start-trial", "Start free trial"],
  ["/contact", "Contact"],
];

function setMeta(html: string, attr: "name" | "property", key: string, content: string): string {
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, "\\$&")}"\\s+content="[^"]*"\\s*/?>`, "s");
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
}

function body(page: SeoPage): string {
  const sections = (page.sections ?? [])
    .map((s) => {
      const paragraphs = (s.paragraphs ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      const items = s.items?.length ? `<ul>${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
      return `<section><h2>${escapeHtml(s.heading)}</h2>${paragraphs}${items}</section>`;
    })
    .join("");
  const nav = NAV.map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`).join(" · ");
  return (
    `<div data-prerendered="${escapeHtml(page.path)}">` +
    `<nav aria-label="GarnishTable">${nav}</nav>` +
    `<main><h1>${escapeHtml(page.h1)}</h1>${page.intro.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${sections}</main>` +
    `</div>`
  );
}

export function renderPage(template: string, page: SeoPage, origin: string): string {
  let html = template;
  if (!html.includes('<div id="root"></div>')) throw new Error("prerender: dist/index.html has no empty #root");

  html = html.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(page.title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/s,
    `<meta name="description" content="${escapeHtml(page.description)}" />`
  );
  for (const [attr, key, value] of [
    ["property", "og:title", page.title],
    ["property", "og:description", page.description],
    ["name", "twitter:title", page.title],
    ["name", "twitter:description", page.description],
  ] as const) {
    html = setMeta(html, attr, key, value);
  }

  const head: string[] = [];
  if (origin) {
    const url = `${origin}${page.path === "/" ? "/" : page.path}`;
    head.push(`<link rel="canonical" href="${escapeHtml(url)}" />`);
    html = setMeta(html, "property", "og:url", url);
  }
  head.push(
    `<script type="application/ld+json" data-jsonld="site">${jsonForScript({ "@context": "https://schema.org", "@graph": siteStructuredData(origin) })}</script>`
  );
  const extra = page.structuredData?.(origin) ?? [];
  if (extra.length) {
    // "faq" matches FaqPage.tsx's runtime applyJsonLd key, so the app doesn't add it a second time.
    const key = page.path === "/faq" ? "faq" : `page-${page.file}`;
    head.push(`<script type="application/ld+json" data-jsonld="${key}">${jsonForScript({ "@context": "https://schema.org", "@graph": extra })}</script>`);
  }
  html = html.replace("</head>", `    ${head.join("\n    ")}\n  </head>`);

  return html.replace('<div id="root"></div>', `<div id="root">${body(page)}</div>`);
}
