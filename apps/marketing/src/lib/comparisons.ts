/**
 * Comparison pages (/compare/<slug>). Every competitor fact here comes from that competitor's own
 * public page, read on `checkedOn`; each source URL is shown on the page. "Not stated" means the page
 * didn't say, never a guess. Re-check before each change and at least quarterly. GarnishTable's own
 * column must state what isn't available yet, as plainly as what is.
 *
 * Toast is deliberately absent: its pages couldn't be read on 27 Nov 2026, so there are no verified
 * facts to compare (docs/growth/keyword-page-map.md).
 */

export interface ComparisonRow {
  label: string;
  garnishtable: string;
  competitor: string;
}

export interface Comparison {
  slug: string;
  competitor: string;
  title: string;
  description: string;
  h1: string;
  /** Answer-first summary (40–60 words). */
  answer: string;
  checkedOn: string;
  sources: { label: string; url: string }[];
  rows: ComparisonRow[];
  chooseGarnishTable: string[];
  chooseCompetitor: string[];
}

/** GarnishTable's side of every table: true today (catalog: apps/api planCatalogSeed.service.ts). */
const GT = {
  price: "Starter $59/month · Growth $99/month",
  annual: "Starter $590/year · Growth $990/year (10 months' price)",
  setup: "None",
  commission: "0% on direct orders",
  payments: "Not available yet: customers pay the restaurant directly (pickup, delivery, table). Online card payments are planned.",
  hardware: "None required: runs in a web browser on your existing devices",
  trial: "14 days, no card required",
  contract: "Monthly or annual; cancel anytime from billing settings",
  app: "No branded mobile app (mobile-friendly ordering page)",
  marketplaces: "Not at launch (Uber Eats, DoorDash, foodpanda planned)",
  pos: "No third-party POS integrations",
};

export const COMPARISONS: Comparison[] = [
  {
    slug: "chownow",
    competitor: "ChowNow",
    title: "GarnishTable vs ChowNow — Commission-Free Online Ordering Compared",
    description:
      "An honest comparison of GarnishTable and ChowNow for independent restaurants: monthly price, setup fees, card processing, trial and features, with sources.",
    h1: "GarnishTable vs ChowNow",
    answer:
      "Both GarnishTable and ChowNow give independent restaurants commission-free direct online ordering. GarnishTable costs $59 or $99 a month with no setup fee and a 14-day free trial, but doesn't take online card payments yet. ChowNow starts at $249 a month (monthly billing) plus setup and card-processing fees, and includes branded apps and POS integrations.",
    checkedOn: "27 November 2026",
    sources: [
      { label: "ChowNow pricing", url: "https://get.chownow.com/pricing/" },
      { label: "ChowNow direct online ordering", url: "https://get.chownow.com/products/direct-online-ordering/" },
    ],
    rows: [
      { label: "Monthly price (monthly billing)", garnishtable: GT.price, competitor: "Starting at $249 (Launch), $349 (Grow), $449 (Elevate) per month. \"Additional fees may apply.\"" },
      { label: "Annual billing", garnishtable: GT.annual, competitor: "Starting at $229, $319 or $409 per month when billed annually" },
      { label: "Setup fee", garnishtable: GT.setup, competitor: "$119 – $499" },
      { label: "Commission on direct orders", garnishtable: GT.commission, competitor: "0% (\"unlimited commission-free orders\")" },
      { label: "Online card payments", garnishtable: GT.payments, competitor: "Yes: 2.95% + $0.29 per transaction" },
      { label: "Hardware", garnishtable: GT.hardware, competitor: "Printer listed as an additional fee ($250–$420)" },
      { label: "Free trial", garnishtable: GT.trial, competitor: "Not stated (\"Book a Demo\" / \"Buy now\")" },
      { label: "Contract terms", garnishtable: GT.contract, competitor: "Not stated on the pricing page" },
      { label: "Branded mobile app", garnishtable: GT.app, competitor: "Yes (plus a $99 annual Apple developer fee)" },
      { label: "Marketplace / third-party orders", garnishtable: GT.marketplaces, competitor: "Order aggregation and a Discovery Network listed" },
      { label: "POS integrations", garnishtable: GT.pos, competitor: "30+ POS integrations listed" },
    ],
    chooseGarnishTable: [
      "You want direct online ordering at a low, flat monthly price, with no setup fee.",
      "Your customers already pay at pickup, on delivery or at the table.",
      "You want to try it free for 14 days without a card, and set it up yourself the same day.",
    ],
    chooseCompetitor: [
      "You need customers to pay online by card today.",
      "You want a branded iOS/Android app or orders flowing into an existing POS.",
      "You want marketplace orders aggregated in one place.",
    ],
  },
  {
    slug: "restolabs",
    competitor: "Restolabs",
    title: "GarnishTable vs Restolabs — Restaurant Online Ordering Compared",
    description:
      "An honest comparison of GarnishTable and Restolabs for independent restaurants: pricing, trial, payments, apps and integrations, with sources.",
    h1: "GarnishTable vs Restolabs",
    answer:
      "GarnishTable and Restolabs both offer commission-free online ordering for restaurants with no hardware to buy. GarnishTable lists its prices publicly ($59 or $99 a month) with a 14-day free trial, but doesn't take online card payments yet. Restolabs offers a 30-day free trial, online payments through many gateways, POS and delivery integrations, and branded apps as an option.",
    checkedOn: "27 November 2026",
    sources: [
      { label: "Restolabs pricing", url: "https://www.restolabs.com/pricing" },
      { label: "Restolabs home page", url: "https://www.restolabs.com/" },
    ],
    rows: [
      { label: "Monthly price", garnishtable: GT.price, competitor: "Basic, Growth and Pro plans; prices weren't shown in readable form on the pricing page. See restolabs.com/pricing." },
      { label: "Annual billing", garnishtable: GT.annual, competitor: "Annual billing \"save 20%\"" },
      { label: "Setup fee", garnishtable: GT.setup, competitor: "Not stated" },
      { label: "Commission on direct orders", garnishtable: GT.commission, competitor: "0% commission" },
      { label: "Online card payments", garnishtable: GT.payments, competitor: "Yes: \"Online Payments (50+ Gateways)\"; rates not stated" },
      { label: "Hardware", garnishtable: GT.hardware, competitor: "None required: \"works on your existing laptop, tablet, or smartphone\"" },
      { label: "Free trial", garnishtable: GT.trial, competitor: "30 days; \"No credit card required to start\"" },
      { label: "Contract terms", garnishtable: GT.contract, competitor: "Month-to-month or annual; no long-term contract" },
      { label: "Branded mobile app", garnishtable: GT.app, competitor: "Included on Pro, or a $49/month add-on" },
      { label: "Marketplace / third-party delivery", garnishtable: GT.marketplaces, competitor: "Third-party delivery integrations listed (e.g. DoorDash, Uber Direct)" },
      { label: "POS integrations", garnishtable: GT.pos, competitor: "On the Growth plan (Toast, Clover, Genius and more listed)" },
    ],
    chooseGarnishTable: [
      "You want simple, published prices and to start the same day on your own.",
      "Your customers already pay at pickup, on delivery or at the table.",
      "You run one or two locations, or you're an agency managing several restaurants on one plan.",
    ],
    chooseCompetitor: [
      "You need online card payments or a branded mobile app now.",
      "You need POS or third-party delivery integrations.",
      "You'd like a longer, 30-day trial.",
    ],
  },
];
