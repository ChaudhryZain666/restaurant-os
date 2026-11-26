# Search engine setup for garnishtable.com

Checked against production on 27 Nov 2026. **Domain verification and sitemap submission have not been done yet.** They need your Google and Microsoft accounts.

## Current state (verified)
- **Canonical domain:** `https://garnishtable.com`. `www.garnishtable.com` redirects to it with a 301.
- **Pages:** each marketing page has its own canonical URL on that domain and its own title and description in the raw HTML.
- **`robots.txt`:** allows crawling and names `https://garnishtable.com/sitemap.xml`.
- **Sitemap:** lists the marketing pages on `https://garnishtable.com`. The legal pages are left out while the legal values are unconfigured.
- **Structured data:** Organization, WebSite, SoftwareApplication (plans and prices) and FAQPage.
- **`/llms.txt`:** served.
- **Not indexed, on purpose:**
  - `app.garnishtable.com` (owner portal): its `robots.txt` allows only `/` and `/login`;
  - `order.garnishtable.com` (storefronts): restaurant pages have their own per-restaurant sitemap from the API.

## 1. Google Search Console (about 10 minutes)
1. Go to https://search.google.com/search-console → **Add property** → choose **Domain**, and enter `garnishtable.com`.
2. Google shows a **TXT record**. Add it at your DNS provider (where `garnishtable.com`'s DNS is managed) as a TXT record on `@`, then click **Verify**. It can take a few minutes to an hour.
3. **Sitemaps** → enter `https://garnishtable.com/sitemap.xml` → **Submit**.
4. **URL inspection:** inspect `https://garnishtable.com/pricing` → **Request indexing**. Do the same for `/`, `/product` and `/faq`.

## 2. Bing Webmaster Tools (about 5 minutes)
1. Go to https://www.bing.com/webmasters and sign in. Choose **Import from Google Search Console** (fastest, once step 1 is done) or add the site and verify by DNS TXT.
2. **Sitemaps** → submit `https://garnishtable.com/sitemap.xml`.
3. Turn on **IndexNow** under Settings. Bing's index feeds Copilot and is one of the sources ChatGPT search uses.

## 3. Remaining technical SEO blockers
| Item | Impact | Fix |
|---|---|---|
| Legal pages send `noindex` and are left out of the sitemap until the five `GT_LEGAL_*` values are set | Trust signals for search and reviewers; the pages can't be indexed | Provide the legal values, then rebuild and deploy the marketing site |
| No backlinks or citations yet | New domains rank slowly | Each launch restaurant's storefront and Google profile linking to garnishtable.com ("Ordering by GarnishTable") is the natural first source |
| Comparison pages not published | Missing high-intent "[competitor] alternative" searches | Publish only with sourced, dated competitor facts (`first-customers-plan.md` §3) |
| Location pages | None yet, by design | Add one page per city once you have a real customer there |

## 4. After submitting
- Check **Pages → Indexed** in Search Console after 1–2 weeks. All 10 marketing pages should become indexed.
- Watch **Performance → Queries** for the terms people actually use, and add FAQ entries in their words.
