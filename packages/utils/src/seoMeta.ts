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

  const created: HTMLElement[] = [];
  function addMeta(attr: "name" | "property", key: string, content: string) {
    const meta = document.createElement("meta");
    meta.setAttribute(attr, key);
    meta.content = content;
    document.head.appendChild(meta);
    created.push(meta);
  }

  // A page that ships a static description in its HTML shell (index.html, for a useful default
  // before React hydrates) would otherwise end up with a second, duplicate tag appended after it —
  // any reader of "the" description tag (a crawler, a querySelector) keeps finding the static
  // shell's text first. Updating the existing tag in place, and restoring it on cleanup, fixes that
  // for real. A page with no static tag falls straight through to the create-and-remove branch.
  const descriptionTag = document.querySelector('meta[name="description"]');
  let previousDescription: string | null = null;
  if (descriptionTag) {
    previousDescription = descriptionTag.getAttribute("content");
    descriptionTag.setAttribute("content", input.description);
  } else {
    addMeta("name", "description", input.description);
  }

  const canonical = document.createElement("link");
  canonical.rel = "canonical";
  canonical.href = input.canonicalUrl;
  document.head.appendChild(canonical);
  created.push(canonical);

  if (input.og?.title) addMeta("property", "og:title", input.og.title);
  if (input.og?.description) addMeta("property", "og:description", input.og.description);
  if (input.og?.type) addMeta("property", "og:type", input.og.type);
  if (input.og?.url) addMeta("property", "og:url", input.og.url);
  if (input.og?.siteName) addMeta("property", "og:site_name", input.og.siteName);
  if (input.og?.image) addMeta("property", "og:image", input.og.image);

  if (input.twitter?.card) addMeta("name", "twitter:card", input.twitter.card);
  if (input.twitter?.title) addMeta("name", "twitter:title", input.twitter.title);
  if (input.twitter?.description) addMeta("name", "twitter:description", input.twitter.description);
  if (input.twitter?.image) addMeta("name", "twitter:image", input.twitter.image);

  return () => {
    document.title = previousTitle;
    if (descriptionTag && previousDescription !== null) {
      descriptionTag.setAttribute("content", previousDescription);
    }
    for (const el of created) document.head.removeChild(el);
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
