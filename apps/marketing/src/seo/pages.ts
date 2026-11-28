import { FAQS, HOW_IT_WORKS_STEPS, OFFER_FEATURES } from "../lib/content.js";
import { COMPARISONS } from "../lib/comparisons.js";
import { GUIDES } from "../lib/guides.js";

/**
 * SEO / answer-engine content for each public marketing page, prerendered into static HTML at build
 * time (vite.config.ts → prerenderPages). The app is client-rendered, so without this every URL
 * served the same index.html: the homepage's title and description, and an empty <div id="root">.
 * Google eventually runs the JavaScript; most answer engines and link unfurlers never do.
 *
 * Each page's `title` and `description` must equal what that page passes to usePageMeta
 * (seoPages.test.mjs checks this), so the static HTML and the running app never disagree.
 * The static body is plain HTML React replaces on mount: an <h1>, short factual paragraphs and
 * internal links. Facts only: nothing here may promise a feature the product doesn't ship.
 */

export interface SeoSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface SeoPage {
  path: string;
  /** File name under dist/_pages/ (nginx serves it for `path`). */
  file: string;
  title: string;
  description: string;
  h1: string;
  intro: string[];
  sections?: SeoSection[];
  /** Extra schema.org nodes for this page (Organization and WebSite are added to every page). */
  structuredData?: (origin: string) => object[];
}

/** The founder-approved catalog (apps/api planCatalogSeed.service.ts), in USD. */
export const PLANS = [
  {
    name: "Owner — Starter",
    monthly: 59,
    yearly: 590,
    summary: "Core online ordering for a single restaurant location: branded ordering page, menu builder, order queue, pickup and delivery.",
  },
  {
    name: "Owner — Growth",
    monthly: 99,
    yearly: 990,
    summary: "Everything in Starter, plus up to 2 locations, your own ordering domain, business-wide analytics and promotions.",
  },
  {
    name: "Agency — Growth",
    monthly: 179,
    yearly: 1790,
    summary: "For agencies managing up to 5 client restaurant businesses, each with Growth-tier features, under one agency login.",
  },
] as const;

const WHAT_IT_IS =
  "GarnishTable is online ordering software for independent restaurants. Each restaurant gets its own branded ordering page, a menu builder, a live order queue for staff, pickup, delivery with its own drivers and table QR ordering, customer history, loyalty and promotions, for a flat monthly subscription with 0% commission on direct orders.";

/** Said plainly wherever pricing or ordering is described: what GarnishTable doesn't do today. */
const LIMITS =
  "Customers pay the restaurant directly at pickup, on delivery or at the table; online card payments aren't available yet. GarnishTable doesn't connect to POS systems or delivery apps, and doesn't offer a future pickup date or time picker.";

function breadcrumbs(origin: string, trail: [string, string][]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: origin ? `${origin}${path}` : undefined })),
  };
}

function softwareApplication(origin: string) {
  return {
    "@type": "SoftwareApplication",
    name: "GarnishTable",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Restaurant online ordering",
    operatingSystem: "Web",
    url: origin || undefined,
    description: WHAT_IT_IS,
    offers: PLANS.map((p) => ({
      "@type": "Offer",
      name: `${p.name} (monthly)`,
      price: p.monthly.toFixed(2),
      priceCurrency: "USD",
      category: "subscription",
      url: origin ? `${origin}/pricing` : undefined,
    })),
  };
}

export const SEO_PAGES: SeoPage[] = [
  {
    path: "/",
    file: "home",
    title: "Restaurant Online Ordering System | GarnishTable",
    description:
      "Restaurant online ordering for independent restaurants: branded menus, pickup and delivery, QR ordering, and order management with no per-order commission.",
    h1: "Restaurant online ordering system for independent restaurants",
    intro: [
      WHAT_IT_IS,
      "Customers order straight from your restaurant instead of a marketplace, so you keep the customer relationship and every order's margin. Start with a 14-day free trial, no credit card required.",
    ],
    sections: [
      {
        heading: "How restaurant online ordering works with GarnishTable",
        items: [
          "Your own branded ordering page: your name, logo, colours and menu, shared on Google, your website, social media and table QR codes.",
          "Customers browse and order: they pick items and options, add a note for anything special, and choose pickup, your own delivery or table service. No app to download.",
          "Orders arrive in one dashboard: every order lands in one live list with its items, options and notes, and staff move it through accept, preparing, ready and completed.",
          "Pickup and your own delivery: switched on separately, with your own delivery fee, minimum order and radius.",
          LIMITS,
        ],
      },
      { heading: "What's included", items: OFFER_FEATURES.map((f) => `${f.title}: ${f.description}`) },
      {
        heading: "Pricing",
        items: PLANS.map((p) => `${p.name}: $${p.monthly}/month or $${p.yearly}/year. ${p.summary}`),
      },
    ],
    structuredData: (origin) => [softwareApplication(origin)],
  },
  {
    path: "/product",
    file: "product",
    title: "Restaurant Online Ordering Software | GarnishTable",
    description:
      "Restaurant online ordering software with branded digital menus, pickup and delivery, QR ordering, order management, loyalty and promotions.",
    h1: "Restaurant online ordering software, feature by feature",
    intro: [WHAT_IT_IS],
    sections: [{ heading: "Features", items: OFFER_FEATURES.map((f) => `${f.title}: ${f.description}`) }],
  },
  {
    path: "/solutions",
    file: "solutions",
    title: "Solutions — GarnishTable",
    description:
      "How different restaurants — independents, counter service, pickup-heavy kitchens, growing multi-location businesses and agencies — use GarnishTable.",
    h1: "Online ordering for every kind of independent restaurant",
    intro: [
      "Independent restaurants, counter-service and pickup-heavy kitchens use GarnishTable to take orders directly. Growing groups run up to two locations on the Growth plan, and agencies manage several client restaurants from one login.",
    ],
  },
  {
    path: "/how-it-works",
    file: "how-it-works",
    title: "How Restaurant Online Ordering Works — GarnishTable",
    description:
      "How to go from signup to your first online order with GarnishTable: create your account, add your menu, brand your page, choose order types, test and share.",
    h1: "How restaurant online ordering works, from signup to your first order",
    intro: ["Six steps you do yourself from the dashboard. No developer needed and no separate website to maintain.", LIMITS],
    sections: [{ heading: "Steps", items: HOW_IT_WORKS_STEPS.map((s, i) => `${i + 1}. ${s.title} — ${s.description}`) }],
  },
  {
    path: "/pricing",
    file: "pricing",
    title: "Restaurant Online Ordering Pricing — GarnishTable",
    description:
      "Restaurant online ordering pricing with no commission per order: Starter $59/month, Growth $99/month, Agency $179/month. 14-day free trial, no card needed.",
    h1: "Restaurant online ordering pricing",
    intro: [
      "Flat monthly or annual plans with 0% commission on direct orders. Every plan starts with a 14-day free trial, no credit card required, or owners can pay now at checkout and skip the trial. Annual billing costs the same as 10 months. Prices are in US dollars. Cancel any time in billing settings; your plan runs to the end of the period you've paid for.",
      LIMITS,
    ],
    sections: PLANS.map((p) => ({
      heading: `${p.name} — $${p.monthly}/month or $${p.yearly}/year`,
      paragraphs: [p.summary],
    })),
    structuredData: (origin) => [softwareApplication(origin)],
  },
  {
    path: "/faq",
    file: "faq",
    title: "Restaurant Online Ordering FAQ — GarnishTable",
    description:
      "Straight answers about GarnishTable's restaurant online ordering: branded ordering page, orders and notes, pickup and delivery, pricing, free trial, payments and integrations.",
    h1: "Restaurant online ordering: frequently asked questions",
    intro: ["Straight answers to what restaurant owners ask before signing up, including what GarnishTable doesn't do yet."],
    sections: FAQS.map((f) => ({ heading: f.q, paragraphs: [f.a] })),
    structuredData: () => [
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  },
  {
    path: "/demo",
    file: "demo",
    title: "Live Demo — GarnishTable",
    description:
      "Switch themes, customize the brand, and place a real order — try the actual GarnishTable product on a real restaurant.",
    h1: "Try the live GarnishTable demo",
    intro: [
      "The demo is the real product running a sample restaurant, Wildwood Kitchen: switch storefront themes, change the brand, and place an order the way a customer would.",
    ],
  },
  {
    path: "/about",
    file: "about",
    title: "About — GarnishTable",
    description:
      "Why GarnishTable exists: restaurants deserve to own their ordering experience and customer relationships, not rent them back from a marketplace.",
    h1: "About GarnishTable",
    intro: [
      "Restaurants deserve to own their ordering experience and their customer relationships, not rent them back from a marketplace. GarnishTable gives independent restaurants their own direct ordering channel for a flat subscription.",
    ],
  },
  {
    path: "/contact",
    file: "contact",
    title: "Contact — GarnishTable",
    description: "Get in touch about starting with GarnishTable, requesting a demo, or getting support for your restaurant.",
    h1: "Contact GarnishTable",
    intro: ["Ask about getting started, request a walkthrough for your restaurant, or get support."],
  },
  {
    path: "/agencies",
    file: "agencies",
    title: "Restaurant Ordering Software for Agencies — GarnishTable",
    description:
      "Offer your restaurant clients commission-free online ordering under your own brand. Manage up to 5 client businesses from one login for $179/month.",
    h1: "Online ordering for your restaurant clients, under your brand",
    intro: [
      "Web designers and marketing agencies use GarnishTable to give independent restaurants their own commission-free ordering page, managed from one agency login. Agency — Growth costs $179/month or $1,790/year for up to 5 client restaurant businesses.",
    ],
    sections: [
      {
        heading: "What agencies get",
        items: [
          "Up to 5 client businesses from one agency dashboard, each with its own locations, staff and owner.",
          "Growth-tier features for each client: up to 2 locations, its own ordering domain, business-wide analytics and promotions.",
          "White-label options per client: your brand name and colour on storefronts, GarnishTable branding hidden, your own support contact.",
          "Client domains, a branded sign-in page, and customer emails from your verified sending domain.",
        ],
      },
      {
        heading: "What isn't included yet",
        items: ["Online card payments: customers pay the restaurant directly.", "Marketplace (Uber Eats, DoorDash, Just Eat, Deliveroo) and POS integrations."],
      },
    ],
  },
  {
    path: "/start-trial",
    file: "start-trial",
    title: "Start Your Free Trial — GarnishTable",
    description:
      "Create your restaurant's branded storefront, add your menu, and start accepting online orders directly — no commission-hungry marketplace.",
    h1: "Start your 14-day free trial",
    intro: ["No credit card required. Create your restaurant, add your menu and publish your ordering page."],
  },
  {
    path: "/guides",
    file: "guides",
    title: "Restaurant Online Ordering Guides — GarnishTable",
    description:
      "Practical guides for restaurant owners: setting up online ordering, choosing a system, direct ordering vs delivery apps, and managing orders in one dashboard.",
    h1: "Restaurant online ordering guides",
    intro: ["Plain-language guides for independent restaurant owners: how online ordering works, what to look for and how to run it day to day."],
    sections: [{ heading: "All guides", items: GUIDES.map((g) => `${g.h1}: ${g.description}`) }],
  },
  // Guide articles: built from lib/guides.ts, the same data GuidePage renders.
  ...GUIDES.map(
    (g): SeoPage => ({
      path: `/guides/${g.slug}`,
      file: `guides/${g.slug}`,
      title: g.title,
      description: g.description,
      h1: g.h1,
      intro: [g.answer, `Updated ${g.updated}.`],
      sections: g.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs, items: s.items })),
      structuredData: (origin) => [
        {
          "@type": "Article",
          headline: g.h1,
          description: g.description,
          dateModified: g.updatedIso,
          datePublished: g.updatedIso,
          author: { "@type": "Organization", name: "GarnishTable" },
          publisher: { "@type": "Organization", name: "GarnishTable" },
          mainEntityOfPage: origin ? `${origin}/guides/${g.slug}` : undefined,
        },
        breadcrumbs(origin, [
          ["Home", "/"],
          ["Guides", "/guides"],
          [g.h1, `/guides/${g.slug}`],
        ]),
      ],
    })
  ),
  // Comparison pages: built from lib/comparisons.ts, the same data ComparisonPage renders, so the
  // static HTML and the app can't disagree.
  ...COMPARISONS.map(
    (c): SeoPage => ({
      path: `/compare/${c.slug}`,
      file: `compare/${c.slug}`,
      title: c.title,
      description: c.description,
      h1: c.h1,
      intro: [c.answer, `${c.competitor} facts are from ${c.competitor}'s own public pages, checked on ${c.checkedOn}.`],
      sections: [
        { heading: "Side by side", items: c.rows.map((r) => `${r.label}: GarnishTable — ${r.garnishtable}. ${c.competitor} — ${r.competitor}.`) },
        { heading: "When GarnishTable is the better fit", items: c.chooseGarnishTable },
        { heading: `When ${c.competitor} is the better fit`, items: c.chooseCompetitor },
        { heading: "Sources", items: c.sources.map((s) => `${s.label}: ${s.url} (checked ${c.checkedOn})`) },
      ],
    })
  ),
];

/** Every page gets the site-wide graph (the same one Layout.tsx adds at runtime). */
export function siteStructuredData(origin: string): object[] {
  return [
    { "@type": "Organization", name: "GarnishTable", url: origin || undefined, logo: origin ? `${origin}/favicon.svg` : undefined },
    { "@type": "WebSite", name: "GarnishTable", url: origin || undefined },
  ];
}
