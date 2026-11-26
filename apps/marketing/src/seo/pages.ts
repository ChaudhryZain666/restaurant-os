import { FAQS, HOW_IT_WORKS_STEPS, OFFER_FEATURES } from "../lib/content.js";

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
  "GarnishTable is online ordering software for independent restaurants. Each restaurant gets its own branded ordering page, a menu builder, a live order queue for staff, pickup and delivery, customer history, loyalty and promotions — for a flat monthly subscription with 0% commission on direct orders.";

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
    title: "GarnishTable — Online Ordering for Independent Restaurants",
    description:
      "Direct online ordering, kitchen, POS, loyalty and analytics in one system for independent restaurants — with 0% platform commission on direct orders.",
    h1: "Online ordering for independent restaurants",
    intro: [
      WHAT_IT_IS,
      "Customers order straight from your restaurant instead of a marketplace, so you keep the customer relationship and every order's margin. Start with a 14-day free trial, no credit card required.",
    ],
    sections: [
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
    title: "Product — GarnishTable",
    description:
      "Everything a restaurant needs to sell direct: digital menu, ordering, delivery, loyalty, promotions and analytics in one platform.",
    h1: "Everything a restaurant needs to sell direct",
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
    title: "How It Works — GarnishTable",
    description: "From signup to your first order in six steps — no developer required, no separate website to maintain.",
    h1: "From signup to your first order in six steps",
    intro: ["No developer and no separate website to maintain: you set up the restaurant yourself from the dashboard."],
    sections: [{ heading: "Steps", items: HOW_IT_WORKS_STEPS.map((s, i) => `${i + 1}. ${s.title} — ${s.description}`) }],
  },
  {
    path: "/pricing",
    file: "pricing",
    title: "Pricing — GarnishTable",
    description:
      "Simple, transparent pricing for restaurant online ordering. Start free, upgrade as you grow — no per-order commission.",
    h1: "Restaurant online ordering pricing",
    intro: [
      "Flat monthly or annual plans with 0% commission on direct orders. Every owner plan starts with a 14-day free trial, no credit card required — or pay now at checkout and skip the trial. Annual billing costs the same as 10 months.",
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
    title: "FAQ — GarnishTable",
    description: "Answers to common questions about setting up and running online ordering with GarnishTable.",
    h1: "Frequently asked questions",
    intro: ["Answers to common questions about setting up and running online ordering with GarnishTable."],
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
    path: "/start-trial",
    file: "start-trial",
    title: "Start Your Free Trial — GarnishTable",
    description:
      "Create your restaurant's branded storefront, add your menu, and start accepting online orders directly — no commission-hungry marketplace.",
    h1: "Start your 14-day free trial",
    intro: ["No credit card required. Create your restaurant, add your menu and publish your ordering page."],
  },
];

/** Every page gets the site-wide graph (the same one Layout.tsx adds at runtime). */
export function siteStructuredData(origin: string): object[] {
  return [
    { "@type": "Organization", name: "GarnishTable", url: origin || undefined, logo: origin ? `${origin}/favicon.svg` : undefined },
    { "@type": "WebSite", name: "GarnishTable", url: origin || undefined },
  ];
}
