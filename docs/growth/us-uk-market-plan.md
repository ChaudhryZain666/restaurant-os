# US and UK market plan

How GarnishTable wins its first customers in the **United States** and the **United Kingdom**, as of 27 Nov 2026. Pakistan is not a target market.

**About keyword data.** No keyword-volume tool was used, so this plan contains **no search volumes, difficulty scores or rankings**. It's built on search intent and on what the product actually does. Google Search Console (verified 27 Nov) shows real queries and impressions **per country** within weeks. Re-rank this plan with that data at the end of month 1 (`seo-performance-tracker.md`).

Everything below separates **what we can do now** from **what needs your decision**.

## 1. The honest position

| Strength | Weakness to state openly |
|---|---|
| Flat, published price ($59 / $99) with 0% commission on direct orders, versus ChowNow from $249/month plus setup fees (their pricing page, 27 Nov) | No online card payments yet: customers pay the restaurant directly. In both markets most direct online orders are paid online, so this is the biggest objection we'll hear. |
| Self-serve, same-day setup with menu import; no hardware, no contract (Toast: approved hardware and typically 12–36 month contracts) | No marketplace sync (Uber Eats, DoorDash, Just Eat, Deliveroo) and no POS integrations |
| 14-day trial, no card | No reviews, customers or case studies yet |
| Agency plan (5 businesses) already sellable | Prices are USD-only: UK buyers see dollars |

**Strategic implication:** the most winnable first customers are those for whom "pay at pickup or at the table" is acceptable:
- **counter-service and collection-heavy takeaways;**
- **cafés;**
- **restaurants that today take orders by phone.**

They need a branded menu and ordering page more than card processing. Target them, and say plainly that online payments are coming. Don't pitch restaurants whose online orders are mostly prepaid delivery; they'll churn.

## 2. US versus UK: what changes

| | United States | United Kingdom |
|---|---|---|
| Owner's words | online ordering, takeout, pickup, curbside, delivery, "online ordering system", POS | takeaway, **collection** / **click and collect**, delivery, "online ordering system", **EPOS** |
| Marketplaces they want to escape | DoorDash, Uber Eats, Grubhub | **Just Eat**, **Deliveroo**, Uber Eats |
| Direct-ordering competitors to know | ChowNow, Toast Online Ordering, Square Online, Owner.com, BentoBox | **Flipdish**, **Slerp**, Toast (UK), Square Online, WordPress/Wix plugins |
| Price expectation | USD monthly SaaS; "no commission" resonates | **GBP**; B2B prices usually shown **ex VAT**. Seeing $ signals "not built for us". |
| Payment expectation | Card online for delivery; cash and card at pickup still common | Card online is the norm for delivery; collection is often paid on pickup |
| Outreach rules | **CAN-SPAM**: commercial email allowed with accurate sender and subject, a postal address and a working opt-out | **PECR + UK GDPR**: a cold email to a **limited company** address is allowed with an opt-out. A **sole trader or partnership** counts as an individual and needs **prior consent**, and many takeaways are sole traders. Prefer contact forms, Instagram DMs (respecting platform rules) and calls to business numbers. |

The competitors listed for the UK (Flipdish, Slerp) aren't verified yet. Read their own pricing pages before writing any comparison, the same way PR #29 did for the US three.

## 3. Search: where we can realistically win, by page

One page per intent (`keyword-page-map.md` still applies). Additions for these markets:

| Priority | Page | Market | Why | Status |
|---|---|---|---|---|
| 1 | `/compare/chownow`, `/compare/toast`, `/compare/restolabs` | US (Toast and Restolabs also UK) | Buyers comparing are closest to paying; we have verified facts | **Built (PR #29), all claims verified; needs your approval** |
| 2 | Commission calculator on `/pricing` ("how much do delivery apps cost me?") | Both | Answers the money question; linkable; converts | Can build now |
| 3 | `/agencies` | Both | The Agency — Growth plan ($179) has no page yet; web designers and marketing agencies serving restaurants are a channel *and* a customer | Can build now (describe today's capabilities, not the white-label roadmap) |
| 4 | Guide: "How to take orders online without Just Eat or Deliveroo" | UK | UK wording; few strong pages target it directly | Can write now |
| 5 | Guide: "How to get more direct online orders" | US-led, works in both | Core problem | Can write now |
| 6 | `/compare/flipdish` (UK) | UK | Flipdish is a main UK direct-ordering name | Needs fact collection first |
| — | Country pages (`/uk`, `/us`) | — | **Not justified yet.** Same product, same price; a country page would only swap words. Revisit when there's GBP pricing or UK-specific features. | Don't build |
| — | `hreflang` | — | Only needed for separate per-country page versions. One English site serves both. | Don't add |

**On-page language:** use both markets' words where it reads naturally, e.g. "pickup and delivery (collection and delivery)", "takeout / takeaway". No separate pages.

## 4. AI answer engines (GEO / AEO)
What helps ChatGPT, Perplexity, Google AI results and Copilot describe GarnishTable accurately:
- **Done:**
  - crawlable page-specific HTML;
  - structured data (Organization, SoftwareApplication with prices, FAQPage);
  - `/llms.txt` with stated limits;
  - Google indexing.
- **Next:**
  - Bing (Copilot and ChatGPT search draw on it);
  - the comparison pages (answer engines quote sourced tables);
  - an About page that says plainly who runs GarnishTable and from where (entity trust);
  - consistent descriptions on every free listing.
- **Measured later:** AI referrals show in analytics as referrers like `chat.openai.com` or `perplexity.ai`. No analytics is installed yet; see §6.
- **Not claimed:** we can't guarantee or verify being cited.

## 5. Remote first-five acquisition (replaces in-person visits)

The week-by-week funnel in `first-five-campaign.md` stays; only the contact method changes.

1. **Find (20 a day):**
   - Google Maps in one US metro and one UK city: independents, takeaways and cafés;
   - signal: an Instagram or Google profile with **no direct ordering link**, or only a Just Eat / DoorDash link;
   - record in the sheet whether it's a company or a sole trader (UK) and the best channel.
2. **Prepare:** import their public menu into the preview restaurant, apply their colour, and record a 60-second screen video of "your menu, ordering direct" (free: Loom free tier or a phone recording).
3. **Contact, one-to-one, never bulk:**
   - **US:** email to the published business address, with the video link; CAN-SPAM footer.
   - **UK:** limited companies by email with an opt-out. Sole traders through their **website contact form** or **Instagram DM** with the video.
   - Follow-up once after 3 days, then stop.
4. **Demo:** a 15-minute video call. Show their own menu, a test order, and the kitchen screen.
5. **Onboard, then convert:** as in `first-five-campaign.md` §4.3–4.4, with a 14-day trial. Paying goes through `garnishtable.com/checkout` (PR #30 makes in-app Subscribe use it too).

**Metric that matters:** trials taking a real customer order in their first 7 days.

## 6. Measurement (free)
| What | Tool | Status |
|---|---|---|
| Queries, clicks, impressions, **by country** (US vs UK) | Google Search Console → Performance → Countries | **Verified 27 Nov**; data in 2–4 days |
| Bing and Copilot visibility | Bing Webmaster Tools | **Needs you** (import from Google) |
| Visitors, referrers (including AI), landing pages | Not installed. Cheapest honest option: a privacy-friendly analytics script | **Your decision**; needs a code change, a cookie/privacy-notice check and a deploy |
| Trials, activations, first orders, paying restaurants, MRR | Platform admin data + Paddle | Available; record weekly in the tracker |

## 7. Decisions only you can make
1. **GBP prices for UK buyers.** Add GBP prices for the existing plans in Paddle, roughly matching $59 / $99 / $179, so UK checkouts show £. This is a price and catalog change. *Recommended before UK outreach scales.*
2. **Publish the comparison pages (PR #29).**
3. **Ship the in-app checkout move (PR #30).**
4. **Analytics:** whether to add a privacy-friendly analytics script.
5. **Storefront footer link:** "Online ordering by GarnishTable" (not on white-label storefronts).
6. **Launch cities:** one US metro, one UK city.
