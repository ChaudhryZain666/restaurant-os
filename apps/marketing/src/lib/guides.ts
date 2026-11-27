/**
 * /guides/<slug>: practical articles for restaurant owners. The page (GuidePage.tsx), the
 * prerendered HTML (seo/pages.ts) and the sitemap all come from this one list, so they can't
 * disagree.
 *
 * Rules for every article:
 * - Describe only what GarnishTable ships today: branded ordering page, menu builder and import,
 *   pickup, the restaurant's own delivery, table QR ordering, order notes, the live order queue,
 *   pay-at-collection, flat pricing and the 14-day trial.
 * - Say plainly what it doesn't do: online card payments, marketplace or POS integrations,
 *   scheduled future pickup times, a branded mobile app.
 * - No invented statistics, studies or customer stories. Advice is general good practice,
 *   written as such.
 */

export interface GuideSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface Guide {
  slug: string;
  /** <title> and og:title. */
  title: string;
  description: string;
  h1: string;
  /** The short, direct answer to the article's main question, shown first. */
  answer: string;
  updated: string;
  /** ISO date for structured data. */
  updatedIso: string;
  sections: GuideSection[];
  /** Internal links shown at the end of the article. */
  related: { label: string; to: string }[];
}

const CORE_LINKS = [
  { label: "See every feature on the product page", to: "/product" },
  { label: "Compare plans and prices", to: "/pricing" },
  { label: "Read how setup works, step by step", to: "/how-it-works" },
  { label: "Try the live demo restaurant", to: "/demo" },
  { label: "Read the FAQ", to: "/faq" },
];

export const GUIDES: Guide[] = [
  {
    slug: "set-up-online-ordering-for-your-restaurant",
    title: "How to Set Up Online Ordering for Your Restaurant (Step by Step)",
    description:
      "A practical, step-by-step guide to setting up online ordering for a restaurant: menu, order types, hours, payment, launch and the first week of orders.",
    h1: "How to set up online ordering for your restaurant",
    answer:
      "To set up online ordering, choose a system that gives you your own ordering page, put your menu in with accurate prices and options, decide which order types you'll take (pickup, your own delivery, table ordering), set your hours, decide how customers pay, test a few orders yourself, and then share the link everywhere your customers already find you.",
    updated: "28 November 2026",
    updatedIso: "2026-11-28",
    sections: [
      {
        heading: "1. Decide what you want online ordering to do",
        paragraphs: [
          "Before you compare systems, write down the problem you're solving. Most restaurants want one of three things: fewer phone orders during the rush, a commission-free alternative to delivery apps, or a way for regulars to order ahead without waiting in line.",
          "The answer shapes everything else. A pizzeria drowning in phone calls needs fast pickup ordering and a clear order queue. A café with a seating area may care more about table ordering. A bakery taking trays and party orders needs room for notes and clear item options.",
        ],
      },
      {
        heading: "2. Choose a system that gives you your own ordering page",
        paragraphs: [
          "Direct online ordering means customers order from a page that belongs to your restaurant, not from a marketplace listing next to your competitors. Look for your own name, logo and colours on the page, a link you can share, and pricing you can predict.",
          "Check the parts that matter day to day: how menus are edited, how orders arrive, whether you can pause ordering, and what the system costs when you're busy. A flat monthly price behaves very differently from a percentage of every order.",
        ],
      },
      {
        heading: "3. Build a menu that's easy to order from",
        paragraphs: [
          "Your online menu isn't a copy of your printed one. Group items into clear categories, write one short line for anything that needs explaining, and set prices exactly as you charge them.",
          "Use options (often called modifiers) for real choices: size, crust, extra cheese, sauce on the side. Make a choice required when the kitchen can't make the item without it, and optional otherwise. Add photos where they help; a good placeholder beats a bad photo.",
        ],
        items: [
          "Start with your best sellers and the items people already order by phone.",
          "Mark items as sold out instead of deleting them, so they come back with one tap.",
          "Read every price twice. A wrong price online is a wrong price on every order.",
        ],
      },
      {
        heading: "4. Choose your order types",
        paragraphs: [
          "Pickup is the simplest place to start: the customer orders, you prepare it, they collect it. If you have your own drivers, you can add delivery with your own fee, minimum order and delivery radius. If you have tables, a QR code per table lets guests order from their phone, and each order arrives tagged with the table.",
          "You don't have to switch everything on at once. Many restaurants launch with pickup, get comfortable with the order flow, and add delivery or table ordering later.",
        ],
      },
      {
        heading: "5. Set opening hours and decide how customers pay",
        paragraphs: [
          "Set your real opening hours so the ordering page stops taking orders when you're closed. Nothing frustrates a customer more than ordering from a kitchen that isn't open.",
          "Decide how customers pay. Some systems take card payments online; others, including GarnishTable today, have customers pay the restaurant directly at pickup, on delivery or at the table. Be clear about it on your page so nobody is surprised.",
        ],
      },
      {
        heading: "6. Test before you launch",
        paragraphs: [
          "Place three or four test orders yourself, on your phone, as a customer would. Try an item with options, add a note, and choose each order type you've enabled. Then watch each order arrive on the restaurant side and move it through to completed.",
          "Ask one member of staff to do the same. If they can't find something on the menu, your customers won't either.",
        ],
      },
      {
        heading: "7. Launch: share the link where customers already are",
        paragraphs: [
          "An ordering page only works if people can find it. Put the link where customers already look for you.",
        ],
        items: [
          "Your Google Business Profile (the website or order link field).",
          "Your Instagram and Facebook bios.",
          "Your own website's main menu and homepage.",
          "Receipts, bags, flyers and a sign at the counter.",
          "A short message on the phone line: \"You can also order online at…\"",
        ],
      },
      {
        heading: "8. Watch the first week closely",
        paragraphs: [
          "In the first week, check every order for problems: confusing options, missing items, wrong prices. Fix them the same day. Ask regulars what they thought. Small fixes in week one save a lot of phone calls later.",
        ],
      },
      {
        heading: "How GarnishTable handles each step",
        paragraphs: [
          "GarnishTable gives each restaurant its own branded ordering page and a menu builder with categories, photos, prices, options and sold-out switches. You can import a menu from your website, a PDF or photos and review it before publishing. Pickup, your own delivery and table QR ordering are each switched on separately. Customers can add notes to their order, and every order arrives in one live list for your team.",
          "Customers pay you directly; GarnishTable doesn't process online card payments today. Plans are a flat $59 or $99 a month with no commission per order, and every plan starts with a 14-day free trial with no card required.",
        ],
      },
    ],
    related: CORE_LINKS,
  },
  {
    slug: "restaurant-online-ordering-system-what-to-look-for",
    title: "Restaurant Online Ordering Systems: What to Look For",
    description:
      "What to look for in a restaurant online ordering system: ownership, pricing model, menu tools, order management, order types, payments and integrations.",
    h1: "Restaurant online ordering systems: what to look for",
    answer:
      "A good restaurant online ordering system gives you your own branded ordering page, a menu you can edit in minutes, a clear queue for incoming orders, the order types you actually use, and pricing you can predict. Check the payment options and integrations you need before you sign, and make sure you can try it before you commit.",
    updated: "28 November 2026",
    updatedIso: "2026-11-28",
    sections: [
      {
        heading: "Who owns the customer relationship?",
        paragraphs: [
          "The first question isn't about features. It's whether customers order from you or from a marketplace. On your own ordering page, the customer sees your brand, your menu and nothing else, and the order history belongs to your restaurant. On a marketplace, you're one listing among many.",
          "Both have a place. Marketplaces can bring new customers. Direct ordering is how you keep the ones you already have.",
        ],
      },
      {
        heading: "How is it priced?",
        paragraphs: [
          "Online ordering systems are usually priced in one of three ways: a percentage of each order, a fee per order, or a flat monthly subscription. Some add setup fees, contracts or hardware.",
          "Work out the cost at your real volume, not the quiet weeks. A flat monthly price stays the same when you're busy; a per-order cost grows with every ticket. Also ask what happens if you want to leave: notice periods and contract length matter.",
        ],
        items: [
          "Monthly price, and the annual price if there's a discount.",
          "Any setup, onboarding or hardware fees.",
          "Per-order fees or commission, if any.",
          "Card processing fees, if the system takes payments.",
          "Contract length and how cancellation works.",
        ],
      },
      {
        heading: "How easy is the menu to build and change?",
        paragraphs: [
          "You'll edit the menu far more often than you think: price changes, specials, sold-out items. Look for categories, photos, required and optional options, and a quick way to mark something sold out.",
          "Ask how the menu gets in at the start. Typing a long menu by hand takes hours; some systems can import it from your website, a PDF or photos, which you then check before publishing.",
        ],
      },
      {
        heading: "How do orders arrive and get managed?",
        paragraphs: [
          "This is where a system earns its keep during service. Orders should land in one clear list, with each order's items, options and the customer's notes in one place. Staff should be able to accept, mark preparing, mark ready and complete each order in a tap.",
          "Check what happens when nobody is looking at the screen. Some systems send an email or another alert so a new order isn't missed.",
        ],
      },
      {
        heading: "Does it support the order types you use?",
        paragraphs: [
          "List the ways you actually serve customers: pickup, your own delivery drivers, dine-in. Then check each one is supported, and can be switched on and off on its own.",
          "If you deliver yourself, look for a delivery fee, a minimum order and a delivery radius. If you have tables, look for QR codes that tag each order with its table.",
        ],
      },
      {
        heading: "How do customers pay?",
        paragraphs: [
          "Some systems take card payments online and pass the money on, minus processing fees. Others have the customer pay the restaurant directly at pickup, on delivery or at the table.",
          "Neither is wrong. What matters is that it matches how you run. If online card payment is a must-have for you, confirm it's available today, not just on a roadmap.",
        ],
      },
      {
        heading: "Which integrations do you really need?",
        paragraphs: [
          "Integrations with point-of-sale systems and delivery apps can save double entry, but they add cost and complexity. Decide which you genuinely need before you shop, and ask each vendor whether each integration is live today.",
        ],
      },
      {
        heading: "Can you try it first?",
        paragraphs: [
          "A free trial or a live demo tells you more than any feature list. Place an order as a customer would, then manage it as your staff would. If either side feels clumsy, it will feel worse on a busy Friday.",
        ],
      },
      {
        heading: "A quick checklist",
        items: [
          "Your own branded ordering page and a link you can share.",
          "A menu with categories, photos, options and sold-out switches.",
          "A clear order queue with notes on each order.",
          "Pickup, delivery and table ordering, each switched on separately.",
          "Opening hours that stop orders when you're closed.",
          "Predictable pricing at your real order volume.",
          "Payment and integrations that match how you run today.",
          "A free trial or live demo before you commit.",
        ],
      },
      {
        heading: "Where GarnishTable fits",
        paragraphs: [
          "GarnishTable is online ordering software for independent restaurants. It gives you a branded ordering page, a menu builder with import from your website, a PDF or photos, pickup, your own delivery and table QR ordering, order notes, and a live order queue. It's a flat $59 or $99 a month with no commission per order, and a 14-day free trial with no card required.",
          "It doesn't take online card payments today. Customers pay you directly. It doesn't connect to POS systems or delivery apps. If you need those now, the comparison pages for Toast, ChowNow and Restolabs explain the differences.",
        ],
      },
    ],
    related: [
      ...CORE_LINKS,
      { label: "GarnishTable vs Toast", to: "/compare/toast" },
      { label: "GarnishTable vs ChowNow", to: "/compare/chownow" },
      { label: "GarnishTable vs Restolabs", to: "/compare/restolabs" },
    ],
  },
  {
    slug: "direct-online-ordering-vs-third-party-delivery-apps",
    title: "Direct Online Ordering vs Third-Party Delivery Apps for Restaurants",
    description:
      "Direct online ordering vs third-party delivery apps: how costs, customer ownership, delivery and discovery differ, and how restaurants use both together.",
    h1: "Direct online ordering vs third-party delivery apps",
    answer:
      "Third-party delivery apps bring you customers who are browsing many restaurants, and they handle delivery, but they charge a commission on each order and keep the customer relationship. Direct online ordering is your own ordering page: you keep the full order value apart from your software cost, and the customer stays yours, but you have to bring the traffic and handle any delivery yourself. Many restaurants use both.",
    updated: "28 November 2026",
    updatedIso: "2026-11-28",
    sections: [
      {
        heading: "What each one is",
        paragraphs: [
          "A third-party delivery app (also called a marketplace) lists many restaurants in one place. Customers browse, order and pay in the app, and the app usually arranges delivery. The restaurant pays the app a commission or fee on each order.",
          "Direct online ordering is an ordering page that belongs to your restaurant. Customers reach it from your website, Google listing, social media or a QR code, and the order comes straight to you.",
        ],
      },
      {
        heading: "Cost: commission versus a fixed price",
        paragraphs: [
          "Marketplace commission is a percentage of each order, so the cost grows with every sale. The exact rate depends on the app, the country and the plan you choose, so check your own contract and statements rather than relying on averages.",
          "Direct ordering software is usually a fixed monthly subscription, plus card processing fees if the system takes payments. To compare honestly, work out what you paid the apps last month and set it against the monthly price of a direct system.",
        ],
      },
      {
        heading: "Who owns the customer",
        paragraphs: [
          "On a marketplace, the app owns the relationship. You may see a name and an order, but the customer comes back to the app, not to you, and next time the app may show them someone else.",
          "On your own ordering page, every order builds your own customer history. That's what makes repeat-order tools like loyalty points and discount codes possible.",
        ],
      },
      {
        heading: "Discovery: who finds new customers",
        paragraphs: [
          "This is where marketplaces are strongest. People open a delivery app to decide what to eat, and being listed there puts you in front of them.",
          "A direct ordering page doesn't come with an audience. It works best for customers who already know you: regulars, neighbours, people who search your name on Google, followers on social media.",
        ],
      },
      {
        heading: "Delivery: who drives",
        paragraphs: [
          "Most marketplaces can arrange a driver for you. With direct ordering, you either offer pickup only or deliver with your own staff, setting your own fee, minimum order and delivery area.",
          "If you don't have drivers, direct ordering can still carry a large share of your orders through pickup and, if you have tables, through table ordering.",
        ],
      },
      {
        heading: "Using both: a practical approach",
        paragraphs: [
          "You don't have to choose one. A common approach is to stay on the apps for discovery while gently moving your regulars to direct ordering.",
        ],
        items: [
          "Put your direct ordering link on your Google Business Profile, website and social bios.",
          "Add a card or sticker to pickup bags and receipts with your ordering link or a QR code.",
          "Offer a discount code for ordering direct, if your margins allow.",
          "Train staff to mention it on the phone: \"You can also order online at…\"",
          "Keep your direct menu and prices up to date so it's never the worse option.",
        ],
      },
      {
        heading: "When the apps are the better choice",
        paragraphs: [
          "Be honest about your situation. If most of your orders are delivery, you have no drivers, and few customers know your name yet, the apps may be doing work direct ordering can't do for you yet. Direct ordering pays off fastest where you already have loyal customers and pickup or dine-in trade.",
        ],
      },
      {
        heading: "How GarnishTable works alongside the apps",
        paragraphs: [
          "GarnishTable is a direct ordering channel. It doesn't connect to Uber Eats, DoorDash, Just Eat or Deliveroo; it runs alongside them. You get your own branded ordering page for pickup, your own delivery and table ordering, with no commission per order: a flat $59 or $99 a month after a 14-day free trial.",
          "Customers pay you directly at pickup, on delivery or at the table; online card payments aren't available today. The commission calculator on the pricing page lets you plug in your own order numbers and commission rate to see the difference.",
        ],
      },
    ],
    related: [
      { label: "Work out your own numbers with the commission calculator", to: "/pricing#commission-calculator" },
      ...CORE_LINKS.filter((l) => l.to !== "/pricing"),
    ],
  },
  {
    slug: "manage-restaurant-online-orders-in-one-dashboard",
    title: "How Restaurants Can Manage Online Orders in One Dashboard",
    description:
      "How to manage restaurant online orders in one dashboard: a simple order workflow, order notes, alerts, the kitchen view, staff roles, hours and busy-night habits.",
    h1: "How to manage online orders in one dashboard",
    answer:
      "Manage online orders by sending every order into one list, moving each one through the same few steps (new, accepted, preparing, ready, completed), reading the customer's notes before you start, and making sure someone, or an alert, always notices a new order. Set your hours so ordering stops when you're closed, and give staff their own logins.",
    updated: "28 November 2026",
    updatedIso: "2026-11-28",
    sections: [
      {
        heading: "Why one list beats many",
        paragraphs: [
          "When orders arrive by phone, walk-in, text and social media at the same time, things get missed: a note scribbled on paper, a message nobody saw. One list for every online order means one place to look, in the order they came in.",
        ],
      },
      {
        heading: "A simple workflow every order follows",
        paragraphs: [
          "Give every order the same short journey, and make sure everyone uses the same words for each step.",
        ],
        items: [
          "New: the order has arrived and nobody has looked at it yet.",
          "Accepted: someone has seen it and the kitchen will make it.",
          "Preparing: it's being made.",
          "Ready: it's waiting for pickup, for the driver or to go to the table.",
          "Completed: the customer has it.",
        ],
      },
      {
        heading: "Read the notes before you start",
        paragraphs: [
          "Customers use order notes and item instructions for the details that matter: an allergy, \"no onions\", the writing on a cake, which door to use. Make reading the notes part of accepting an order, not something you notice halfway through making it.",
          "If a note asks for something you can't do, call the customer before you start, not after.",
        ],
      },
      {
        heading: "Make sure a new order is never missed",
        paragraphs: [
          "The biggest risk with online orders is the one nobody sees. Keep the order screen open on a tablet or computer where the team can see it, and check what alerts your system sends when nobody is watching.",
        ],
      },
      {
        heading: "Give the kitchen its own view",
        paragraphs: [
          "Front of house needs customer details; the kitchen needs items, options and notes, in order. A separate kitchen board showing what's new, preparing and ready keeps both sides working from the same orders without crowding each other's screen.",
        ],
      },
      {
        heading: "Give staff their own logins",
        paragraphs: [
          "Shared passwords make it impossible to know who did what, and painful to change when someone leaves. Separate logins for managers and staff are simple to set up and easy to remove.",
        ],
      },
      {
        heading: "Busy-night habits",
        items: [
          "Mark items sold out the moment they run out.",
          "Set realistic opening hours so ordering stops when the kitchen closes.",
          "Keep one person responsible for the order screen during the rush.",
          "Check completed orders at the end of the night for anything left open.",
        ],
      },
      {
        heading: "Use your order history",
        paragraphs: [
          "Once orders flow through one system, you can see what's actually selling, when you're busiest and who your regulars are. Use that to set prep levels, plan staffing and decide what to promote.",
        ],
      },
      {
        heading: "How it works in GarnishTable",
        paragraphs: [
          "In GarnishTable, every online order from your ordering page, whether pickup, delivery or a table order, lands in one live list. Each order shows its items, options and the customer's notes. Staff move it through accept, preparing, ready and completed, and a kitchen board shows the same orders for the kitchen. If nobody has the orders page open when an order comes in, the restaurant gets an email.",
          "You can give staff their own logins, set opening hours that stop orders when you're closed, and see order history and simple analytics. GarnishTable doesn't connect to POS systems or delivery apps, so orders taken on those stay where they are. Plans are a flat $59 or $99 a month with a 14-day free trial.",
        ],
      },
    ],
    related: CORE_LINKS,
  },
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug);
