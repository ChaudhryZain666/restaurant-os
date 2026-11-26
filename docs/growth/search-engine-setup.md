# Search engine setup for garnishtable.com

Checked against production on 27 Nov 2026. **Domain verification and sitemap submission have not been done yet.** They need your Google and Microsoft accounts.

## Current state (verified)
- **Canonical domain:** `https://garnishtable.com`. `www.garnishtable.com` redirects to it with a 301.
- **Pages:** each marketing page has its own canonical URL on that domain and its own title and description in the raw HTML.
- **`robots.txt`:** allows crawling and names `https://garnishtable.com/sitemap.xml`.
- **Sitemap:** lists all 13 public pages on `https://garnishtable.com`, including `/terms`, `/privacy` and `/refund-policy` (configured, no `noindex`).
- **Structured data:** Organization, WebSite, SoftwareApplication (plans and prices) and FAQPage.
- **`/llms.txt`:** served.
- **Not indexed, on purpose:**
  - `app.garnishtable.com` (owner portal): its `robots.txt` allows only `/` and `/login`;
  - `order.garnishtable.com` (storefronts): restaurant pages have their own per-restaurant sitemap from the API.

`garnishtable.com`'s DNS is hosted by **Hostinger** (nameservers `*.dns-parking.com`), so the verification record is added in Hostinger.

## 1. Google Search Console (about 15 minutes)
**Verify the domain**
1. Open https://search.google.com/search-console and sign in with the Google account that should own the site's data.
2. **Add property** → the left box, **Domain** → enter `garnishtable.com` → **Continue**.
3. Google shows a TXT record that starts `google-site-verification=…`. Click **Copy**, and leave this page open.
4. In a new tab, open Hostinger → **Domains** → `garnishtable.com` → **DNS / Nameservers** → **DNS records**.
5. **Add record:** Type **TXT**, Name `@`, TXT value: paste the copied text, TTL: leave the default → **Add record**. Don't edit or delete the existing A, CNAME or MX records.
6. Back in Search Console, click **Verify**. If it says not found, wait 10–30 minutes and click **Verify** again; DNS changes take time to spread.

**Submit the sitemap**
7. In the property, choose **Sitemaps** (left menu) → under "Add a new sitemap" type `sitemap.xml` (the field already shows `https://garnishtable.com/`) → **Submit**. The status should turn **Success** with 13 discovered pages; this can take a few hours.

**Request indexing for the key pages**
8. Paste `https://garnishtable.com/` into the search bar at the top (**URL inspection**). "URL is not on Google" is normal for a new site. Click **Request indexing**.
9. Repeat for `https://garnishtable.com/pricing`, `/product` and `/faq`, and the comparison pages once they're live. There's a daily limit of roughly a dozen requests, so do the most important first.

**Check indexing and errors (after 3–7 days, then weekly)**
10. **Indexing → Pages:** the count of **Indexed** pages should rise toward 13. Under "Why pages aren't indexed":
    - **Discovered/Crawled – currently not indexed** is normal at first; it usually resolves as the site gains links.
    - **Page with redirect**, **Not found (404)** or **Duplicate without user-selected canonical** need action: copy the URL to me.
11. **URL inspection → Test live URL** on any page shows what Google renders and any page errors.
12. Record the numbers in `seo-performance-tracker.md`.

## 2. Bing Webmaster Tools (about 5 minutes, after Google is verified)
1. Open https://www.bing.com/webmasters and sign in with a Microsoft, Google or Facebook account.
2. Choose **Import** from Google Search Console and authorize it. This copies the verified site and its sitemap, with no second DNS record needed.
   - Without Google: **Add your site manually** → `https://garnishtable.com` → verify by **DNS TXT** (add the record Bing shows in Hostinger, as in step 5 above).
3. **Sitemaps** → confirm `https://garnishtable.com/sitemap.xml` is listed; if not, **Submit sitemap** and enter it.
4. **URL inspection** → enter `https://garnishtable.com/` → **Request indexing**.
5. After a few days, check **Site explorer** for indexed URLs and **Search performance** for queries.

Bing's index also feeds Microsoft Copilot and is one of the sources used by ChatGPT search, so it matters beyond Bing itself.

Never mark these as done in the tracker until the console shows **Verified** and the sitemap shows **Success**.

## 3. Remaining technical SEO blockers
| Item | Impact | Fix |
|---|---|---|
| No backlinks or citations yet | New domains rank slowly | Storefront footers don't name or link to GarnishTable yet (checked 27 Nov). An "Online ordering by GarnishTable" footer link, kept off white-label storefronts, would make every restaurant a natural first source. Needs your go-ahead (`organic-authority-plan.md` §2). |
| Comparison pages not published | Missing high-intent "[competitor] alternative" searches | Publish only with sourced, dated competitor facts (`first-customers-plan.md` §3) |
| Location pages | None yet, by design | Add one page per city once you have a real customer there |

## 4. After submitting
- Check **Indexing → Pages** in Search Console after 1–2 weeks. All 13 sitemap pages should become indexed.
- Watch **Performance → Queries** for the terms people actually use, and add FAQ entries in their words.
