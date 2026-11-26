# Keyword-to-page map

Each search intent has **one** page, so GarnishTable's pages never compete with each other. As of 27 Nov 2026.

**About search volumes.** No keyword tool was available while writing this, so there are no volume or difficulty numbers here. Pages are chosen by **intent and business value**: a restaurant owner comparing or buying software. Once Google Search Console has 4–6 weeks of data (`search-engine-setup.md`), use **Performance → Queries** to re-rank, and record each change in `seo-performance-tracker.md`. If you want rough volumes sooner, Google Ads' Keyword Planner is free with a Google Ads account; no ads are needed.

Status key: **Live** = on garnishtable.com now. **Planned** = should be built. **Hold** = blocked until a condition is met.

## Existing pages

| URL | Primary keyword (intent) | Secondary keywords | Questions it answers | Conversion goal | Status and next improvement |
|---|---|---|---|---|---|
| `/` | online ordering system for restaurants (commercial) | commission-free online ordering; direct online ordering for restaurants; online ordering for independent restaurants | What is GarnishTable? Who is it for? What does it cost? | Start trial / Pay now / Live demo | **Live, prerendered.** Keep the H1 and first paragraph answering "what it is, who it's for, what it costs" in about 50 words. |
| `/product` | online ordering software for restaurants (commercial, feature research) | restaurant order management software; restaurant menu management software; restaurant digital menu; QR ordering for restaurants | What does the software do? Pickup and delivery? Menu photos and modifiers? | Live demo → trial | **Live.** Add one H2 section per feature cluster (ordering, menu, orders and kitchen, customers and loyalty), each opening with a one-sentence answer. |
| `/pricing` | restaurant online ordering pricing (transactional) | online ordering system cost; no commission online ordering; restaurant ordering software price | How much does it cost? Is there a commission? Is there a trial? | Pay now / Start trial | **Live, with SoftwareApplication offers.** Add the commission-cost calculator (`first-customers-plan.md` §4) and a "what's not included yet" line. |
| `/how-it-works` | how to set up online ordering for a restaurant (informational to commercial) | how to start online ordering; restaurant online ordering setup | How long does setup take? Do I need a developer? | Start trial | **Live.** Add the real setup time once measured with launch restaurants. |
| `/solutions` | online ordering for small restaurants (commercial, by segment) | pizzeria online ordering; takeaway ordering system; multi-location restaurant ordering | Is it right for my type of restaurant? | Trial | **Live.** Name the segments in H2s (pickup-heavy, counter service, 2 locations, agencies). |
| `/demo` | restaurant online ordering demo (commercial, evaluation) | online ordering website example | What does it look like for customers? | Try the storefront → trial | **Live.** |
| `/faq` | (answer-engine hub, no single keyword) | "is there a commission", "how do customers pay", "can I use my own domain" | The real objections | Trial | **Live, with FAQPage data.** Add questions in prospects' exact words as they're asked. |
| `/start-trial` | restaurant online ordering free trial (transactional) | — | — | Signup | **Live.** It's a conversion page; it doesn't need to rank. |
| `/about`, `/contact` | brand: "GarnishTable" (navigational) | — | Who is behind it? | Trust | **Live.** About should state who runs the company and where; answer engines use this for brand entity facts. |
| `/terms`, `/privacy`, `/refund-policy` | — | — | — | Trust | **Live and indexable** (configured in production; in the sitemap). |
| `/checkout` | — | — | — | Payment | Not in the sitemap, on purpose. |

## Planned pages, in priority order

| # | URL | Primary keyword | Why it's worth it | Hold conditions |
|---|---|---|---|---|
| 1 | `/compare/chownow` | ChowNow alternative / ChowNow pricing comparison | High-intent buyers are already comparing; GarnishTable's price gap is large ($59 vs ChowNow's stated $249+/month monthly billing, plus their setup fee) | **Built in PR #29**, from ChowNow's own pricing page (27 Nov). Recheck before publishing. |
| 2 | `/compare/restolabs` | Restolabs alternative | Same audience: independents, 0% commission | **Built in PR #29.** Restolabs' plan prices weren't readable, so the page says so; confirm and add them if you can. |
| 3 | `/compare/toast` | Toast online ordering alternative | Toast is the best-known brand; searchers include restaurants that don't want POS hardware or a 12–36 month contract | **Built in PR #29**, from Toast's own pricing page, read in a browser on 27 Nov. |
| 4 | `/guides/direct-online-ordering` (pillar) | how to get more direct online orders for a restaurant | The core problem GarnishTable solves; links to `/pricing`, `/product` and the compare pages | — |
| 5 | `/guides/restaurant-ordering-software` (pillar) | how to choose online ordering software for a restaurant | Buyer's-guide intent; a natural home for an honest checklist | — |
| 6 | `/agencies` | white-label restaurant ordering software / restaurant software for agencies | The Agency — Growth plan exists today ($179/month, up to 5 businesses). This page sells it. | Don't promise full white-label yet (roadmap §17); describe what exists now. |
| 7 | `/tools/commission-calculator` | food delivery commission calculator | A free, linkable tool that earns backlinks | Optional; can live inside `/pricing` first. |
| 8 | City pages | "online ordering for restaurants in [city]" | Local intent | **Hold** until there's a real customer in that city (no thin pages). |

## Rules that prevent cannibalization
- "Pricing" or "cost" queries go **only** to `/pricing`. Guides link to it; they never restate the price table.
- Feature queries ("menu management software", "order management") go to `/product` sections, not separate thin pages. A feature only gets its own page once it has enough unique content and search demand to stand alone.
- Each competitor keyword has exactly one `/compare/*` page.
- Guides target "how to" questions; product pages target "software" queries.
