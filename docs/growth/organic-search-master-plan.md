# Organic search master plan

Organic search (Google, Bing and AI answer engines) is GarnishTable's main acquisition channel, with no paid advertising. As of 27 Nov 2026.

This document sets the strategy and the order of work. The details live in:
- `keyword-page-map.md`: which page targets which search;
- `organic-authority-plan.md`: free backlinks and listings;
- `seo-performance-tracker.md`: what to measure, weekly;
- `search-engine-setup.md`: Google and Bing setup steps;
- `first-five-campaign.md`: direct outreach, which runs alongside search, because search takes months.

Nothing here can guarantee rankings or mentions by AI tools. What we control: crawlable, accurate, useful pages; clear structured data; genuine links and mentions; and pages that convert visitors.

## 1. Where we are

| Area | State | Evidence |
|---|---|---|
| Crawlable content | Each marketing page has its own prerendered HTML: title, description, canonical URL, H1, factual text, internal links | PR #27 (`48708a7`) |
| Structured data | Organization, WebSite, SoftwareApplication with the three plan offers, FAQPage | PR #27 |
| AI-tool summary | `/llms.txt`: what it is, prices, trial, what's not available yet | PR #27 |
| Domain | `https://garnishtable.com` is canonical; www redirects with a 301 | Production check |
| Sitemap and robots | Correct, on the canonical domain | Production check |
| Search Console and Bing | **Not set up yet** | Needs you: `search-engine-setup.md` |
| Legal pages | `noindex` until the legal values are set | Weakens trust signals |
| Backlinks | Essentially none (new domain) | The biggest long-term gap |
| Content depth | 10 product pages, no guides or comparison pages | The next build work |

## 2. Strategy in one paragraph
A new domain won't win broad head terms like "online ordering system" quickly. It can win **specific, high-intent searches** first:
- comparison searches ("ChowNow alternative");
- cost and commission searches ("restaurant online ordering with no commission");
- honest how-to guides that restaurant owners actually look for.

Each of those pages links to `/pricing` and the trial. Authority then comes from real restaurants using GarnishTable: every storefront and Google Business Profile that links back. Answer engines quote clear, consistent, factual pages, so every page opens with a direct answer, and the brand facts are identical everywhere (site, `/llms.txt`, directory listings).

## 3. Work order (only what moves trials and revenue)

| Order | Work | Effort | Why now |
|---|---|---|---|
| 1 | Google Search Console and Bing verification, sitemap submission | You, 15 minutes | Nothing gets measured or indexed fast without it |
| 2 | Set the legal values (terms, privacy, refund) | You, 15 minutes | Removes `noindex`; trust signals; Paddle review |
| 3 | `/compare/chownow` and `/compare/restolabs` with sourced, dated facts | 1 PR | Highest buying intent we can rank for early |
| 4 | Commission-cost calculator on `/pricing` | 1 PR | Converts comparison and pricing traffic; linkable |
| 5 | Pillar guide: "How to get more direct online orders" | 1 article, about 1,500 words | The core problem; links to everything |
| 6 | `/agencies` page for the existing Agency — Growth plan | 1 PR | A second customer type, already sellable |
| 7 | Free listings and the first real backlinks (`organic-authority-plan.md`) | Ongoing, 2 hours a week | Authority compounds |
| 8 | Second pillar: "How to choose restaurant ordering software" plus supporting articles | 1 a fortnight | Topic authority |
| 9 | `/compare/toast` | After facts are collected by hand | Toast blocked automated reading |
| 10 | City pages | Only with a real customer in the city | Avoids thin pages |

## 4. Content clusters

Each pillar targets one "how to" intent and links to 3–5 supporting articles, `/product`, `/pricing` and one comparison page. Supporting articles link back to the pillar.

| Pillar | Supporting articles (each with a real purpose) |
|---|---|
| **Getting more direct online orders** | How restaurants accept online orders without a marketplace · Getting customers to order direct instead of through apps (links on Google, Instagram, receipts, table QR codes) · What marketplace commissions really cost (with the calculator) · Setting up pickup and delivery zones |
| **Choosing restaurant ordering software** | Ordering software checklist (commission, setup fees, payment processing, hardware, contracts) · Restaurant website vs. ordering page: what you actually need · Online menus that sell: photos, modifiers, item descriptions |
| **Running online orders day to day** | Managing an order queue in a small kitchen · Menu changes and sold-out items · Using customer history and loyalty to bring people back |
| **For agencies (once `/agencies` is live)** | Offering online ordering to your restaurant clients · Managing several restaurants from one login |

**Writing rules:**
- Open with a 40–60 word direct answer.
- Use real numbers only from public sources, cited and dated.
- Every claim about GarnishTable must be true today; say plainly what isn't available yet.
- One clear next step per article: the trial, the demo or pricing.

## 5. AEO and GEO (being understood and quoted by answer engines)
- **Same brand facts everywhere:** "GarnishTable is online ordering software for independent restaurants… flat monthly subscription, 0% commission on direct orders." It's used in `/llms.txt`, the homepage prerender, the SoftwareApplication data, and every directory listing. Keep them identical when prices or features change (the `/llms.txt` and `src/seo/pages.ts` plan lists are the sources).
- **Answer-first headings:** H2s phrased as the question ("Is there a commission?"), with the answer in the first sentence.
- **Limits stated honestly:** no online card payments yet, no marketplace sync yet. Answer engines and buyers both trust pages that state limits, and it prevents bad-fit signups.
- **Structured data that matches visible content only.** No Review or AggregateRating markup until there are genuine reviews.
- **Earn mentions:** directory profiles, restaurant storefronts linking back, and answering questions in owner communities (`organic-authority-plan.md`).

## 6. Conversion (search traffic is only worth what converts)
In order, all already listed in `first-customers-plan.md` §4:
1. Commission calculator on `/pricing`.
2. The demo link next to the plans.
3. Trial versus pay-now stated once, plainly.
4. "Not included yet" next to the plans.
5. The seller name on Paddle checkout (waiting on Paddle).

Once the first launch restaurants agree in writing, add their real storefronts as live examples, and later genuine testimonials. Never invented ones.
