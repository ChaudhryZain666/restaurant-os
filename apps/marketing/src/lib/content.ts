// Shared marketing copy/content used across the homepage and dedicated pages, kept in one place
// so the "teaser" version on Home and the full version on a dedicated page never drift apart.

// `status` is force-typed to the full union (not narrowed to a single literal by `as const` below)
// so callers like OperationsBoard.tsx can keep a `feature.status === "roadmap"` check that stays
// valid for any future roadmap entry, even while every current feature is "available". `id` is
// deliberately left for `as const` to infer as a literal union — OperationsBoard.tsx indexes an
// icon map and types its `Tile` prop by that literal set.
type FeatureStatus = "available" | "roadmap";

export const OFFER_FEATURES = [
  { id: "online-ordering", title: "Online Ordering", description: "Let customers order directly from your restaurant — no marketplace commission on every ticket.", status: "available" as FeatureStatus },
  { id: "digital-menu", title: "Digital Menu", description: "Mobile-friendly menus with photos, categories, modifiers, pricing, descriptions and live availability.", status: "available" as FeatureStatus },
  { id: "order-management", title: "Order Management", description: "Staff receive, accept, prepare and complete orders from one clear queue.", status: "available" as FeatureStatus },
  { id: "delivery", title: "Delivery", description: "Deliver with your own drivers: set a delivery fee, minimum order and radius, managed alongside pickup in the same dashboard.", status: "available" as FeatureStatus },
  { id: "customers", title: "Customer Management", description: "See every customer's order history so you actually know your regulars.", status: "available" as FeatureStatus },
  { id: "promotions", title: "Promotions", description: "Create discount codes — percentage or fixed-amount off — that customers apply at checkout.", status: "available" as FeatureStatus },
  { id: "analytics", title: "Analytics", description: "Revenue, order volume and top sellers — see how the restaurant is really doing.", status: "available" as FeatureStatus },
  { id: "loyalty", title: "Loyalty", description: "Reward returning customers with points that keep them ordering direct.", status: "available" as FeatureStatus },
  { id: "qr-ordering", title: "QR Ordering", description: "Customers scan a code at the table and order straight from their phone — no app to download.", status: "available" as FeatureStatus },
  { id: "multi-location", title: "Multi-location", description: "Run up to 2 locations on the Growth plan, each with its own menu, staff, hours and orders.", status: "available" as FeatureStatus },
  { id: "branding", title: "Restaurant Branding", description: "Your logo, your colors, your identity — not a generic marketplace listing.", status: "available" as FeatureStatus },
  { id: "support", title: "Customer Support", description: "A built-in help center and support tickets for questions from your customers.", status: "available" as FeatureStatus },
] as const;

export const HOW_IT_WORKS_STEPS = [
  { title: "Create your account", description: "Choose a plan for your 14-day trial, create your login, confirm your email and add your restaurant's name. No card is needed to start." },
  { title: "Add your menu", description: "Import your menu from your website, a PDF or photos and check every item before it goes live, or build it by hand: categories, items, prices, options and photos." },
  { title: "Make it look like your restaurant", description: "Add your logo, cover photo and brand colour, and pick a storefront theme for your ordering page." },
  { title: "Choose how you take orders", description: "Switch on pickup, delivery with your own drivers (your fee, minimum order and radius) or table QR ordering, and set your opening hours." },
  { title: "Test it, then share your link", description: "Place a test order on your phone, then put your ordering link on your Google Business Profile, website, social bios and receipts." },
  { title: "Run orders from one dashboard", description: "Every order arrives in one live list with the customer's notes. Staff accept, prepare, mark ready and complete each one." },
] as const;

export const BENEFITS = [
  { title: "Own your customer relationship", description: "Build a direct ordering channel instead of renting one from a marketplace." },
  { title: "Give customers a better ordering experience", description: "Beautiful menus designed for how people actually order on their phones." },
  { title: "Reduce dependence on third-party channels", description: "Make direct ordering the easy, obvious choice for your regulars." },
  { title: "Increase repeat orders", description: "Order history, loyalty points and promo codes work together to bring people back." },
  { title: "Understand your business", description: "Analytics turn every order into a decision you can actually act on." },
  { title: "Look professional online", description: "Every restaurant gets a polished digital ordering experience, not a bare-bones form." },
] as const;

export const FAQS = [
  { q: "What is GarnishTable?", a: "GarnishTable is online ordering software for independent restaurants. You get your own branded ordering page, a menu builder, and one dashboard where your team receives and manages every order, for a flat monthly price with no commission per order." },
  { q: "How does restaurant online ordering work with GarnishTable?", a: "You add your menu and switch on the order types you want. Customers open your ordering page, choose items and options, add any notes and place the order. It arrives in your dashboard straight away, your team prepares it, and the customer pays you at pickup, on delivery or at the table." },
  { q: "Do I get my own branded ordering page?", a: "Yes. Your ordering page shows your restaurant's name, logo, cover photo and brand colour, with a storefront theme you choose. On the Growth plan you can also connect your own domain, such as order.yourrestaurant.com." },
  { q: "How do customers place orders?", a: "Customers open your ordering page from a link, your website, your Google listing or a table QR code. They browse your menu, pick options such as size or extras, add notes, choose pickup, delivery or table service, and place the order. No app download is needed." },
  { q: "How do I receive and manage orders?", a: "Every order lands in one live list in your dashboard, with its items, options and the customer's notes. Staff accept it, mark it preparing and ready, then complete it. There's a kitchen board for the kitchen, and the restaurant gets an email if an order arrives while nobody has the orders page open." },
  { q: "Can I offer pickup and delivery?", a: "Yes. Pickup and delivery are switched on separately. Delivery uses your own drivers: you set the delivery fee, minimum order and delivery radius. GarnishTable doesn't provide drivers or a delivery fleet." },
  { q: "Can customers add notes or special instructions?", a: "Yes. Customers can add a note to the whole order and instructions to each item, such as no onions or the writing on a cake. There's no option to choose a future pickup date or time, so customers who need one can write it in the note." },
  { q: "How much does GarnishTable cost?", a: "Owner Starter is $59 a month for one location. Owner Growth is $99 a month for up to 2 locations, with your own domain, business-wide analytics and promotions. Agency Growth is $179 a month for up to 5 client businesses. Annual billing costs the same as 10 months. There's no commission on any order." },
  { q: "Is there a free trial?", a: "Yes. Every plan starts with a 14-day free trial, and no card is needed to start. Nothing is charged during the trial; if you want to keep going, you choose a plan and pay then." },
  { q: "What do I need to get started?", a: "Your restaurant's name and address, your menu (a website, PDF or photos you can import, or a list to type in), your opening hours, and your logo if you have one. Menu import still needs you to check each item and price before you go live." },
  { q: "Can I manage more than one location?", a: "Yes, on the Growth plan: up to 2 locations, each with its own menu, staff, hours and orders, plus a business-wide view across both. For more locations, contact us." },
  { q: "Do you offer agency or white-label options?", a: "Yes. The Agency Growth plan lets an agency manage up to 5 client restaurant businesses from one login, each with up to 2 locations. Agencies can switch on white-label options per client, such as their own brand name and colour on the storefront and their own support contact." },
  { q: "Can customers pay online by card?", a: "Not today. Customers pay the restaurant directly at pickup, on delivery or at the table. Online card payment isn't available yet." },
  { q: "Does GarnishTable integrate with my POS or with Uber Eats, DoorDash, Just Eat or Deliveroo?", a: "Not today. GarnishTable is your own direct ordering channel. It runs alongside any POS or delivery app you already use, but doesn't connect to them, so orders taken on those systems stay there." },
  { q: "Can I cancel, and how do I get help?", a: "You can cancel any time from your billing settings. Your subscription stays active to the end of the period you've paid for, and you can undo a scheduled cancellation before it takes effect. For help, use the contact page and we'll reply by email." },
] as const;

/** The pricing page's own short FAQ: a subset of FAQS, so the two can't drift. */
const PRICING_FAQ_QUESTIONS: readonly string[] = [
  "How much does GarnishTable cost?",
  "Is there a free trial?",
  "Can I cancel, and how do I get help?",
  "Can customers pay online by card?",
  "Can I manage more than one location?",
];
export const PRICING_FAQS = FAQS.filter((f) => PRICING_FAQ_QUESTIONS.includes(f.q));
