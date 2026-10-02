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
  { id: "delivery", title: "Delivery", description: "Manage delivery areas, fees and workflows alongside pickup, in the same dashboard.", status: "available" as FeatureStatus },
  { id: "customers", title: "Customer Management", description: "See every customer's order history so you actually know your regulars.", status: "available" as FeatureStatus },
  { id: "promotions", title: "Promotions", description: "Create discount codes — percentage or fixed-amount off — that customers apply at checkout.", status: "available" as FeatureStatus },
  { id: "analytics", title: "Analytics", description: "Revenue, order volume and top sellers — see how the restaurant is really doing.", status: "available" as FeatureStatus },
  { id: "loyalty", title: "Loyalty", description: "Reward returning customers with points that keep them ordering direct.", status: "available" as FeatureStatus },
  { id: "qr-ordering", title: "QR Ordering", description: "Customers scan a code at the table and order straight from their phone — no app to download.", status: "available" as FeatureStatus },
  { id: "multi-location", title: "Multi-location", description: "Run every location from one dashboard, with its own menu overrides, staff and hours.", status: "available" as FeatureStatus },
  { id: "branding", title: "Restaurant Branding", description: "Your logo, your colors, your identity — not a generic marketplace listing.", status: "available" as FeatureStatus },
  { id: "support", title: "Customer Support", description: "A built-in help center and ticketing system for every question that comes in.", status: "available" as FeatureStatus },
] as const;

export const HOW_IT_WORKS_STEPS = [
  { title: "Create your restaurant", description: "Sign up and tell us about your restaurant — name, cuisine, and where you're located." },
  { title: "Add your menu", description: "Add categories, products, photos, prices and modifiers in a menu builder made for restaurants." },
  { title: "Customize your restaurant", description: "Apply your brand color and details so the ordering page looks unmistakably yours." },
  { title: "Publish your ordering page", description: "Your restaurant gets its own online ordering experience, ready to share with customers." },
  { title: "Start receiving orders", description: "Customers browse your menu, choose pickup or delivery, and order directly from you." },
  { title: "Manage everything", description: "Orders, customers, analytics and loyalty — all from one restaurant dashboard." },
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
  { q: "What is this platform?", a: "An online ordering platform built specifically for independent restaurants — your own branded menu, order management, and customer tools in one place." },
  { q: "Can customers order directly from my restaurant?", a: "Yes. Customers browse your menu and order straight from your restaurant's own ordering page — pickup or delivery." },
  { q: "Can I add food images?", a: "Yes, every menu item supports a photo. Items without one get a polished placeholder instead of a blank box." },
  { q: "Can I customize my restaurant menu?", a: "You control your categories, items, prices, descriptions, modifiers and availability, plus your brand color." },
  { q: "Can customers choose pickup or delivery?", a: "Yes, both can be enabled independently, with their own settings like delivery fee and minimum order amount." },
  { q: "Can I manage my orders?", a: "Yes — a live order queue lets staff accept, prepare and complete orders as they come in." },
  { q: "Can I see restaurant analytics?", a: "Yes, a dashboard shows revenue, order volume, average order value and your best-selling items." },
  { q: "Can I manage multiple locations?", a: "Yes — one dashboard for every location, each with its own menu overrides, staff, hours and orders, plus a business-wide view across all of them." },
  { q: "Can I offer promotions and loyalty?", a: "Yes — both are available today. Loyalty points accrue automatically, and you can create your own percentage or fixed-amount discount codes." },
  { q: "Do you take a commission on my orders?", a: "No. It's a flat monthly subscription — 0% commission on every direct order, however many you take." },
  { q: "How do I get paid?", a: "Payments run through your own Stripe account, connected via a guided, Stripe-hosted setup — no API keys to manage. Stripe's own processing fees apply, same as they would anywhere else." },
  { q: "Can I connect Uber Eats, DoorDash or foodpanda?", a: "Not yet at launch. Marketplace connections switch on one provider at a time, as each approves GarnishTable — Uber Eats first, then DoorDash and foodpanda. Your direct ordering never depends on any of them." },
  { q: "Can I use my own domain for ordering?", a: "Yes — connect your own domain (like order.yourrestaurant.com) so your ordering page lives under your own brand, not ours." },
  { q: "Can agencies manage multiple restaurant clients?", a: "Yes — an agency account manages every client business it oversees from one login, each with its own storefront, staff and owner, under consolidated agency billing." },
  { q: "Can I change plans later?", a: "Yes, anytime — upgrade or change plans directly from your billing settings as your restaurant grows." },
  { q: "Is there a free trial?", a: "Yes — a 14-day trial, no credit card required. Create your account on the Start Free Trial page and your restaurant is ready to set up immediately." },
  { q: "Can I cancel anytime?", a: "Yes — cancel anytime from your billing settings. Your subscription stays active through the end of your current billing period, and you can undo a scheduled cancellation anytime before it takes effect." },
] as const;
