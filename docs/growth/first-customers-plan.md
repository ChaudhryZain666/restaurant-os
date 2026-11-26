# Getting the first paying restaurants

Plan as of 26 Nov 2026. Production runs `4ea2598`, with Paddle Live checkout open at `garnishtable.com/checkout`.

**Goal:** 5 paying restaurants within 8 weeks. 20 restaurants trialling or on a launch-partner plan along the way.

The work starts with the restaurants you can reach personally and with a demo, not with search. Search and answer engines are the slow channel; set them up now so they compound.

## 1. Shipped in this change (technical SEO, GEO, AEO)

| Change | Why it matters |
|---|---|
| **Pages are prerendered at build time.** Every page has its own static HTML in `dist/_pages/`, served by nginx at the page's URL. Each has its own title, description, canonical URL, Open Graph tags, a real `<h1>`, factual text and internal links. | Before, every URL returned the same HTML: the home page's title and description and an empty `<div id="root">`. Google renders JavaScript eventually; most AI answer engines and link previews don't. They now see real, page-specific content. |
| **Structured data in the static HTML:** Organization + WebSite on every page; SoftwareApplication with the three plan offers on `/` and `/pricing`; FAQPage on `/faq`. | Eligibility for rich results. Answer engines quote structured facts (price, what it is). The app no longer injects a duplicate copy. |
| **`/llms.txt`:** a plain-text summary with prices, the trial, what's included, what's *not* available yet, and links. | A cheap, emerging convention that some AI tools read. It also states the limits honestly (no online card payments yet, no marketplace connections), so answers about GarnishTable stay accurate. |
| **Tests:** prerendered titles and descriptions must equal each page's own; nginx must serve each file under its URL and never at `/_pages/`; the production build test checks the output; the plain `index.html` (404 fallback) never carries page content. | The static HTML and the app can't drift apart. |

One deliberate difference: the prerendered `<h1>` is keyword-led ("Online ordering for independent restaurants"), while the live hero says "Your restaurant. Running on your terms." Both are served to everyone, so this isn't cloaking. If you'd rather they match, change one of them.

## 2. Search: next steps, in order

1. **Your actions, one-time, about 30 minutes:**
   - Verify `garnishtable.com` in Google Search Console and Bing Webmaster Tools. Use the DNS TXT method; there's nothing to deploy.
   - Submit `https://garnishtable.com/sitemap.xml` to both.
   - Exact steps: `search-engine-setup.md`. Bing's index also feeds Copilot and is one of the sources ChatGPT search uses.
2. **Legal pages: done.** `/terms`, `/privacy` and `/refund-policy` are configured in production (checked 27 Nov 2026): no `noindex`, and listed in the sitemap. Keep them accurate as the business changes.
3. **Keywords. Aim at a few pages written for buying intent, not traffic volume:**
   - "commission-free online ordering for restaurants" → the home page and `/pricing`. This is the core position.
   - "online ordering system for small restaurants" / "restaurant ordering website" → `/product`.
   - "[competitor] alternative" → the comparison pages (§3).
   - "how much does restaurant online ordering cost" → a pricing explainer section with a commission-cost calculator (§5).
4. **Location pages: none yet.** A city page only earns its place once you have a real customer or a live demo partner in that city, and real local content (their storefront, their quote, local delivery facts). One genuine page per city you sell in beats a hundred templated ones. Thin city pages get filtered out and can drag the whole domain down.
5. **AEO.** Each new page opens with a 40–60 word direct answer to its question, then the detail. The FAQ is already marked up; add questions as prospects ask them, using their exact words.

## 3. Comparison pages (Toast, ChowNow, Restolabs)

**Not published yet, on purpose.** A comparison page is only useful, and only legally safe, if every claim about a competitor is accurate, current and sourced. Their prices and terms change often.

For each page (`/compare/toast`, `/compare/chownow`, `/compare/restolabs`):
1. **Collect from their public pricing and product pages, dated:** price, commission or fees, contract length, hardware requirement, whether online payments are included, setup fees. Keep the URL and date of each fact.
2. **Structure:**
   - who each product is for (be fair: Toast is a full POS with hardware, and that's a real strength for some restaurants);
   - a feature and cost table with the date of each fact;
   - when GarnishTable is the better choice: independent restaurants that want direct ordering with no commission and no hardware;
   - when it isn't: you need integrated card payments today, or marketplace sync.
3. **Before publishing:** a footnote with sources and "last checked" dates, and a calendar reminder to re-check quarterly.
4. **Technically:** add each page to `src/seo/pages.ts`, `App.tsx`, the nginx route list and `public/sitemap.xml`. The tests enforce the first three.

## 4. Conversion: pricing and checkout

Ordered by impact:
1. **Commission-cost calculator on `/pricing`.** Input weekly orders × average ticket × marketplace commission; output what that costs per month versus a flat $59 or $99. Use a commission range the restaurant enters, not a hard-coded "industry" number.
2. **Show the live demo next to the plans.** "See it on a real restaurant": one click to the Wildwood Kitchen storefront and the `/demo` theme switcher.
3. **Answer the trial-or-pay choice above the fold.** The trial needs no card; paying now skips it. It's already true, so say it once, plainly.
4. **Name what's not included, near the plans.** Online card payments are coming; customers pay the restaurant directly today. Stating it up front prevents refund requests and builds trust. It's already in the FAQ, but buyers decide on the pricing page.
5. **Seller name.** Until Paddle shows "GarnishTable" on checkout and receipts, buyers see a personal name at the most sensitive moment. Fixing this is in progress with Paddle support.

## 5. First campaign: "Launch partner" outreach

**Who.** Independent restaurants with 1–2 locations that already take online orders through a marketplace (they understand the problem). Prioritise places where:
- the owner is reachable;
- there's an obvious direct-order gap: no ordering link on their own site or Instagram, or only a marketplace link.

Start with 100 restaurants in **one city you can visit**; pick the city before starting.

**Offer.** The standard 14-day free trial (no card) at the existing prices, with you doing the setup. Any extra launch incentive (a longer free period, a founding-customer price) is **your decision and not part of this plan yet**; `first-five-campaign.md` §3 lists the options and how each would be set up. Ask happy trial restaurants for a short testimonial and permission to show their storefront as an example.

**How you onboard them.** You create the restaurant and invite the owner from the platform admin, import their menu (PDF, photos or URL import), and publish with them on a 30-minute call. This exact path is covered end to end by `e2e/platform-admin-onboarding-subscription.spec.ts`.

**Sequence, per restaurant:**
| Day | Touch |
|---|---|
| 0 | Visit or call at a quiet hour (2–4 pm). Show their own menu already loaded on a draft storefront: build it the day before from their public menu with menu import. |
| 0 | Leave a one-page handout with a QR code to the live demo, and follow up by email or WhatsApp the same day with their draft storefront link. |
| 3 | Follow-up: "Want me to publish it? I can do it in 30 minutes with you." |
| 10 | Last touch: one concrete number, e.g. "at 40 orders a week, a 25% commission on a $20 ticket is $800/month" (use their real numbers if they shared them). |

**Opening message (adapt it):**
> Hi [name], I built a commission-free ordering page for [restaurant] using your current menu: [link to the draft storefront]. Customers order directly from you, and you keep the whole order, with no per-order fee. I'll set it up with you, and you can try it free for 14 days with no card. Would you like me to publish it for you this week?

**Measure, weekly, in a simple sheet:**
- contacted;
- replied;
- demo shown;
- published;
- first real order;
- converted to paid.

Expected funnel: 100 contacted → about 25 conversations → about 10 trials → **3–5 paying** by week 8. Week-by-week execution: `first-five-campaign.md`.

**Weekly rhythm:**
- 20 new restaurants contacted;
- all follow-ups sent;
- every live partner's order count checked;
- one improvement shipped from partner feedback.

## 6. What you need to do

1. Pick the launch city.
2. Verify the domain in Google Search Console and Bing, and submit the sitemap (§2.1).
3. Check the comparison pages' sources and approve PR #29.
