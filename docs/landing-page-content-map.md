# Landing page content map (marketing homepage)

Snapshot of everything currently on `apps/marketing`'s homepage (`src/pages/HomePage.tsx`), in the
exact order it renders, before planning the next design strategy. Each entry: role, real copy
(quoted, not paraphrased), real data shown, the visual/interaction mechanism, and any links.

Theme rhythm across the page: alternating dark ("ink") and warm ("parchment") chapters — a
deliberate "high movement → calm" pacing, not a random palette switch (see HomePage.tsx's own
section comments for the reasoning behind each transition).

---

## 1. Hero — "Arrival"
**Role:** first impression; establishes the product and the visual language (technical/blueprint, not restaurant photography).
**Eyebrow:** "Built for independent restaurants"
**Headline:** "Your restaurant. *Running on your terms.*"
**Body:** "GarnishTable gives your restaurant a branded ordering page, a real order-management dashboard, and the customer data a marketplace app never hands back to you."
**Trust row:** "No commission on direct orders" · "Your own brand, not a listing"
**Footer strip:** "Best for — independent restaurants, not a listing" · "Best at — ordering, menu, delivery, loyalty, analytics" · "Replaces — commission-charging marketplace apps"
**Data:** demo numbers `$8,420` (revenue this week), `47` (orders today); ticket items "Margherita Pizza ×2," "Loaded Fries ×1," "Caesar Salad ×1," orders #214/215/216.
**Visual:** `HeroBackdrop` — CSS blueprint grid + spotlight, lazily upgraded to a real Three.js/R3F 3D scene on eligible desktops (silent fallback otherwise, skipped on mobile/reduced-motion/low-power/no-WebGL). `HeroScene` — a 3D-tilted browser-chrome frame with a **real live iframe** of the demo storefront, scroll-linked tilt, plus a cycling kitchen-ticket object beside it.
**Links:** Start Free Trial → `/start-trial`; View Demo → `/demo`.

## 2. What Is GarnishTable
**Role:** plain-English explainer, first calm/parchment beat.
**Eyebrow:** "What is GarnishTable?"
**Headline:** "Everything your restaurant needs to sell directly online."
**Body:** "GarnishTable gives your restaurant its own branded online ordering experience — the menu, the ordering page, the dashboard behind it, and the customer relationship that comes from all of it — instead of a listing inside a marketplace app."
**Data:** 6 pillars — Your restaurant, Your menu, Your branding, Your online ordering, Your customer relationship, Your operational tools.
**Visual:** 2/3-col icon+text grid, scroll-reveal stagger.
**Links:** none.

## 3. Operations Board — "the restaurant coming alive"
**Role:** feature showcase as a live operations board, not a card grid.
**Eyebrow:** "Now operating."
**Headline:** "Everything a restaurant needs to sell online."
**Sub:** "Not a stripped-down ordering form — a full restaurant commerce toolkit, in one dashboard."
**Data (12 tiles):** Online Ordering ($12.50 Margherita, $7 Loaded Fries, "$0.00 commission"), Order Management (#1047, New/Preparing/Ready), Analytics ($8,420/week + sparkline), Digital Menu, Delivery (18 min ETA), Customers (Jordan Lee, 12 orders), Promotions (code WELCOME10), Loyalty (2,140 pts, 71% bar), QR Ordering, Multi-Location, Branding (4 swatches), Support (live chat example).
**Visual:** 12-tile animated bento grid, staggered reveal, per-tile live "moments," "STN.0X" station numbering. *(Now has a scroll-linked parallax grid layer added on top — see `ScrollParallaxGrid.tsx`.)*
**Links:** each tile → `/product#{id}`.

## 4. Product Showcase — "the control room"
**Role:** live product proof, not screenshots.
**Eyebrow:** "See it in action."
**Headline:** "This is Wildwood Kitchen, live."
**Body:** "Our demo restaurant, running on the real platform — not a screenshot. Explore the menu, then switch over to see the owner dashboard, menu management, and order queue behind it."
**Data:** 4 tabs — Owner Dashboard, Menu Management, Orders, Live Storefront (real iframe, demo restaurant "Wildwood Kitchen").
**Visual:** tabbed monitor-wall (1 big + 3 small previews, click to swap), the live iframe never remounts. *(Also has the scroll-linked parallax grid layer added.)*
**Links:** none (iframe embed only).

## 5. Journey Route — "how it works"
**Role:** signup → launch → operate walkthrough.
**Eyebrow:** "How it works."
**Headline:** "From signup to your first order."
**Legs:** Setup, Launch, Operate (grouping 6 steps).
**Data:** mini UI moments — restaurant creation ("Bella Vista," Italian, Boston MA), brand-color picker, publish state ("bellavista.garnishtable.app" — Live), orders (#1047/#1046), manage stats (Revenue $8,420, Orders 312).
**Visual:** single scroll-linked vertical path with a traveling marker, node-by-node reveal.
**Links:** "See the full walkthrough" → `/how-it-works`.

## 6. Who Is It For
**Role:** audience segmentation.
**Eyebrow:** "Who it's for."
**Headline:** "Built for how you actually run restaurants."
**Body:** "Whether you run one restaurant, a growing group of locations, or manage restaurant clients for a living, GarnishTable is built around that shape of business — not retrofitted onto it."
**Data (3 cards):** For restaurant owners ("Run one restaurant, your way"); For growing restaurant groups ("Scale without losing your identity"); For agencies ("One login, every client's business").
**Visual:** 3-col card grid, icon badges.
**Links:** `/start-trial`, `/solutions#growing`, external agency signup URL.

## 7. Why GarnishTable
**Role:** differentiation pitch.
**Eyebrow:** "Why GarnishTable."
**Headline:** "Not a generic ordering system, and not a marketplace."
**Data:** 6 pillars — Your brand; Direct ordering; No GarnishTable commission ("0% platform commission on direct orders — a flat subscription instead. Payment processing and any delivery-provider fees are separate, real costs, never hidden as 'free.'"); Built for restaurants; Restaurant + agency workflows; Flexible integrations.
**Visual:** 3-col icon grid.
**Links:** "integrations" pillar → `#integrations` anchor.

## 8. Theme Showcase
**Role:** storefront design gallery.
**Eyebrow:** "Storefront themes."
**Headline:** "Your restaurant doesn't have to look like everyone else's."
**Body:** "Five distinct storefront themes, each a genuinely different layout and register — not the same template recolored."
**Data (5 real themes):** Cinematic ("A restaurant-film website, not an app"), Luxury ("Quality communicated through restraint"), Contemporary ("Designed by a digital art director"), Urban ("Built for premium street-food and modern-casual"), Minimal ("The absence of visual noise is the design").
**Visual:** card grid, color-swatch headers.
**Links:** "Open the playground" → `/demo`.

## 9. Integrations Section
**Role:** honest integrations/status list.
**Eyebrow:** "Integrations."
**Headline:** "Connect the tools your restaurant already uses."
**Body:** "Payments and delivery marketplaces, connected through the setup each provider actually supports — nothing here is faked as instant when it isn't."
**Data:** Stripe (available), Uber Eats (available), DoorDash ("Coming soon"), foodpanda ("Set up by our team," managed).
**Visual:** 2-col status-badge cards.
**Links:** none (anchor target only, `#integrations`).

## 10. Scale Selector — "Pricing"
**Role:** pricing as a growth narrative, not a flat table.
**Eyebrow:** "Pricing."
**Headline:** "Choose the scale of your restaurant."
**Body:** "The same system, growing with the business — no per-order commission at any tier."
**Stages:** Start / Prove / Scale, each with narrative copy.
**Data:** real plans pulled live from `usePublicPlans()` (locations, businesses, custom domains, analytics, promotions, trial days) — not hardcoded.
**Visual:** pinned scrollytelling, animated SVG "floor plan" that densifies (tables → kitchen → order ticket → sparkline → promo tag → satellite locations), tweened price counter.
**Links:** "Start Free Trial" → `/start-trial`; "See full pricing" → `/pricing`.

## 11. Why We Exist
**Role:** problem statement — tool fragmentation.
**Eyebrow:** "Why we exist."
**Headline:** "Restaurants didn't choose to be this fragmented."
**Body:** "A website here. A marketplace listing there. A delivery app, a loyalty card, a spreadsheet for the numbers, a POS that doesn't talk to any of it — and none of it is really yours."
**Converged caption:** "Ordering, menu, customers, delivery, loyalty and analytics — one system, owned by the restaurant."
**Data:** 6 scattered labels — Website, Marketplace listing, Delivery app, Loyalty punch card, Spreadsheet, POS.
**Visual:** scroll-linked convergence of scattered chips into the real logo mark.
**Links:** none.

## 12. Why Useful
**Role:** before/after value demonstration (data ownership).
**Eyebrow:** "Why it's useful."
**Headline:** "More than another ordering form."
**Body:** "Not a feature list — what actually changes when the data is yours."
**Data:** before/after panel — Customer "Jordan Lee" vs. "Unknown"; Orders today 47 vs. "?"; Repeat rate 38% vs. "—"; Who owns this data "You" vs. "The marketplace." Plus a 6-item benefits list below.
**Visual:** morphing before/after data panel on scroll, 2-col benefit list.
**Links:** none.

## 13. What We Replace
**Role:** cost-consolidation pitch vs. a patchwork of tools.
**Eyebrow:** "What we replace."
**Headline:** "You don't need a pile of separate tools."
**Body:** "A representative stack, not any one competitor — the kind most independent restaurants end up assembling."
**Data:** 5 fragment "invoices" — Website builder $29/mo; Ordering app $79/mo + ~15%/order; Delivery dispatch $59/mo; Loyalty punch cards ($0, no data); Spreadsheet ($0, hours of it) — collapsing into one live-priced plan summary.
**Visual:** fanned/rotated paper "invoice" cards collapsing on scroll into one plan-summary card.
**Links:** none.

## 14. Main Goal
**Role:** emotional thesis/climax, deliberately restrained (no new animation techniques — explicit design intent in the code).
**Eyebrow:** "The main goal."
**Headline:** "Every order should build your business — not someone else's."
**Body:** "That's the whole premise. Ordering, menu, customers, delivery, loyalty and analytics, working together, owned by the restaurant that earned them."
**Data:** `$8,420` (weekly revenue, direct), `312` (orders, no commission), `0%` (cut to a marketplace).
**Visual:** minimal — fade/translate headline, animated number counters.
**Links:** none.

## 15. Mini FAQ
**Role:** quiet close after Main Goal's peak.
**Content:** first 4 items from the real FAQ list, accordion (shared `FaqItem` component with `/faq`).
**Links:** "View all FAQs" → `/faq`.

## 16. Final CTA
**Role:** bookends the Hero — same blueprint grid + radial glow, logo mark as closing signature, same trust row.
**Headline:** "Ready to own your ordering experience?"
**Body:** "Tell us about your restaurant — our team will get your ordering page set up."
**Trust row:** "No commission on direct orders" · "14-day trial, no card required"
**Links:** Start Free Trial → `/start-trial`; View Demo → `/demo`.

---

## Cross-cutting observations (for strategy planning)

- **Recurring demo numbers** (`$8,420`, `47`, `312`, `0%`, "Jordan Lee," "Wildwood Kitchen") appear in the Hero, Operations Board, Journey Route, Why Useful, and Main Goal — a deliberate consistent demo-data thread, not duplicated content by accident.
- **Real, live data** already exists in two places: `ProductShowcase`'s iframe (a genuine running demo storefront) and `ScaleSelector`'s pricing (pulled from `usePublicPlans()`, not hardcoded). Any redesign should preserve both rather than replacing them with static mockups.
- **16 total sections**, alternating dark/parchment chapters, each with its own distinct visual mechanism (bento grid, tabbed monitor wall, scroll-linked path, animated floor-plan, morphing panel, collapsing invoices, convergence animation) — no two sections share the same interaction pattern today.
- **Everything requiring photography today is deliberately avoided** — the whole site is graphic/technical (blueprint grid, iframes, SVG paths, UI mockups), no restaurant/food photography anywhere on the current homepage.
- **`MainGoal` is explicitly documented in-code as intentionally static** ("mostly typography and stillness") — any new motion strategy should treat that as a deliberate exception, not an oversight.
