export interface SeoMetaOpenGraph {
  title?: string;
  description?: string;
  type?: string;
  url?: string;
  siteName?: string;
  image?: string;
}

export interface SeoMetaTwitter {
  card?: "summary" | "summary_large_image";
  title?: string;
  description?: string;
  image?: string;
}

export interface SeoMetaInput {
  title: string;
  description: string;
  canonicalUrl: string;
  og?: SeoMetaOpenGraph;
  twitter?: SeoMetaTwitter;
}

/**
 * Phase 79 — shared per-page SEO tag mechanics, used by apps/web (MenuPage) and apps/marketing
 * (usePageMeta), which previously hand-rolled the same create/cleanup DOM logic independently with
 * one real behavioral difference: description-tag handling. This keeps the more correct of the two
 * (update an existing tag in place and restore it on cleanup, rather than always appending a
 * duplicate) everywhere.
 *
 * Deliberately NOT exported from this package's default barrel (see package.json's `exports` map
 * — import via "@restaurant/utils/seoMeta") — apps/api's Jest config resolves @restaurant/utils to
 * this package's TypeScript source, and apps/api's tsconfig has no DOM lib. A file that touches
 * `document` reaching apps/api's type-checked program at all (even via an unrelated barrel export)
 * breaks its build; keeping this off the default barrel means apps/api's program never includes it.
 */
export function applySeoMeta(input: SeoMetaInput): () => void {
  const previousTitle = document.title;
  document.title = input.title;

  // Every tag is updated in place when the HTML shell already ships it (index.html carries static
  // defaults — description, Open Graph, Twitter — so crawlers that never run JavaScript still get a
  // useful preview) and restored on cleanup; otherwise it's created and removed. Never a duplicate:
  // any reader of "the" og:title or canonical keeps finding exactly one.
  const created: HTMLElement[] = [];
  const restores: (() => void)[] = [];
  function setTag(selector: string, create: () => HTMLElement, attr: string, value: string) {
    const existing = document.head.querySelector(selector);
    if (existing) {
      const previous = existing.getAttribute(attr);
      existing.setAttribute(attr, value);
      restores.push(() => {
        if (previous === null) existing.removeAttribute(attr);
        else existing.setAttribute(attr, previous);
      });
      return;
    }
    const el = create();
    el.setAttribute(attr, value);
    document.head.appendChild(el);
    created.push(el);
  }
  function setMeta(attr: "name" | "property", key: string, content: string) {
    setTag(
      `meta[${attr}="${key}"]`,
      () => {
        const meta = document.createElement("meta");
        meta.setAttribute(attr, key);
        return meta;
      },
      "content",
      content
    );
  }

  setMeta("name", "description", input.description);
  setTag(
    'link[rel="canonical"]',
    () => {
      const link = document.createElement("link");
      link.rel = "canonical";
      return link;
    },
    "href",
    input.canonicalUrl
  );

  if (input.og?.title) setMeta("property", "og:title", input.og.title);
  if (input.og?.description) setMeta("property", "og:description", input.og.description);
  if (input.og?.type) setMeta("property", "og:type", input.og.type);
  if (input.og?.url) setMeta("property", "og:url", input.og.url);
  if (input.og?.siteName) setMeta("property", "og:site_name", input.og.siteName);
  if (input.og?.image) setMeta("property", "og:image", input.og.image);

  if (input.twitter?.card) setMeta("name", "twitter:card", input.twitter.card);
  if (input.twitter?.title) setMeta("name", "twitter:title", input.twitter.title);
  if (input.twitter?.description) setMeta("name", "twitter:description", input.twitter.description);
  if (input.twitter?.image) setMeta("name", "twitter:image", input.twitter.image);

  return () => {
    document.title = previousTitle;
    for (const restore of restores) restore();
    for (const el of created) el.remove();
  };
}

/**
 * Injects a single JSON-LD <script> tag and returns its cleanup. Pure DOM mechanics only — schema
 * construction (what `data` actually contains) stays with each call site, which alone knows what
 * real data is available and how to shape it (Organization+WebSite, FAQPage, Restaurant+Menu, ...).
 * Malformed input can't break page rendering: JSON.stringify on a plain data object never throws
 * for the object shapes this package's callers build (no circular refs, no BigInt/function fields).
 */
export function applyJsonLd(data: object): () => void {
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
  return () => {
    document.head.removeChild(script);
  };
}
