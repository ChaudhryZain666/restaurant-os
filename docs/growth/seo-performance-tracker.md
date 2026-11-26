# SEO performance tracker

A weekly 20-minute review, kept in a spreadsheet with the tabs below. Fill it from **Google Search Console** and **Bing Webmaster Tools** once they're set up (`search-engine-setup.md`). Until then, only the **Authority** and **Content** tabs have data. As of 27 Nov 2026.

## Tab 1: Weekly summary (one row per week)
| Week ending | Google impressions | Google clicks | Avg position | Bing impressions | Bing clicks | Indexed pages (Google) | Trials started | Pay-now purchases | Trials from organic* | Notes |
|---|---|---|---|---|---|---|---|---|---|---|

\*"Trials from organic": ask each new trial how they found GarnishTable. There's no analytics tool installed, so this is the honest way to attribute until one is added.

## Tab 2: Pages (Search Console → Pages / Performance → Pages)
| URL | Indexed (Y/N, reason if not) | Impressions (28 days) | Clicks | CTR | Avg position | Top query | Action |
|---|---|---|---|---|---|---|---|

Start with the 10 marketing pages in `keyword-page-map.md`. **Target:** all 10 indexed within 2–3 weeks of submitting the sitemap.

## Tab 3: Queries (Performance → Queries)
| Query | Page ranking | Impressions | Clicks | Position | Matches the intended page? | Action |
|---|---|---|---|---|---|---|

**What to act on:**
- **Impressions, but position 8–20:** improve that page's answer section and internal links.
- **High impressions, low CTR:** rewrite the title or description (in `src/seo/pages.ts` and the page's `usePageMeta`; the test keeps them equal).
- **A query landing on the wrong page:** fix it per `keyword-page-map.md`.
- **A new question you didn't target:** add it to the FAQ in the searcher's words.

## Tab 4: Content log
| Date | Page or article | Target keyword | Published | First indexed | Impressions after 4 weeks | Notes |
|---|---|---|---|---|---|---|

## Tab 5: Authority log
| Date | Site | Type (listing / partner / community / customer link) | URL of our mention | Link (follow/nofollow) | Free? (verified) | Result |
|---|---|---|---|---|---|---|

## Checks before each content or SEO deploy
- The marketing node tests pass (`npm test -w apps/marketing`), keeping titles and descriptions equal to the pages and the nginx mapping correct.
- The production build test passes (`infrastructure/production/test/marketing-legal-build-test.sh`).
- After deploy: the raw HTML of each changed page shows its own title, canonical URL and H1.

## Milestones (realistic for a new domain, with no promises)
| By | Milestone |
|---|---|
| Week 2 after Search Console setup | All marketing pages indexed |
| Month 2 | Impressions for brand and comparison queries; first organic trial |
| Month 3–4 | Comparison and guide pages ranking for some of their long-tail queries |
| Month 6 | Organic search a regular source of trials alongside outreach |
