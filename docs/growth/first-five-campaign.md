# First five paying restaurants: an 8-week execution plan

This is the plan for the launch campaign, as of 27 Nov 2026. It turns `first-customers-plan.md` §5 into week-by-week work.

**Pricing:** unchanged.
- Owner — Starter: $59/month or $590/year.
- Owner — Growth: $99/month or $990/year.

The offer is the product's existing **14-day free trial, no card**. No discount is part of this plan. If you want a launch incentive (a longer trial, a free first month, a founding-customer price), decide it first. §3 lists the options and how each would be set up.

**Goal:** 5 restaurants paying by the end of week 8. The weekly numbers in §6 show whether you're on track.

## 0. Before week 1 (your decisions and setup)

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Pick the launch city: one you can visit, with plenty of independent restaurants | You | **Pending** |
| 2 | Decide whether there's any launch incentive beyond the 14-day trial (§3) | You | **Pending** |
| 3 | Paddle approves `app.garnishtable.com`, so owners can upgrade inside the app. Until then they pay at `garnishtable.com/checkout` with the same email (§4.3). | Paddle | Resubmitted, awaiting review |
| 4 | Paddle shows "GarnishTable" as the seller | Paddle support (Ivan) | Follow-up sent, awaiting reply |
| 5 | Google Search Console and Bing verification and sitemap submission (`search-engine-setup.md`) | You | **Pending** |
| 6 | Set up a tracking sheet with the columns in §6 | You | **Pending** |
| 7 | One-page leave-behind: QR code to `garnishtable.com/demo`, the two prices, "no commission on direct orders", your phone number | You | **Pending** |

## 1. Who to target

Independent restaurants with 1–2 locations in the launch city that:
- already take online orders, through a marketplace link or phone orders, so they understand the need;
- have no direct-ordering link of their own, or only a marketplace link, on their website, Google Business Profile or Instagram;
- have an owner or manager you can actually reach.

**Build the list in week 1:** 100 restaurants, from Google Maps searches like "restaurant", "pizza", "burgers" or "takeaway" in each neighbourhood, checking each one's website and Google profile for an ordering link. Record the owner's name and contact when they're public.

## 2. The pitch: what they get, honestly
- **Their own ordering page:** their menu, their brand, pickup and delivery. Customers order from them, not from a marketplace.
- **No commission** on direct orders; a flat $59 or $99 a month.
- **Set up for them:** you load their menu and publish it with them in a 30-minute call.
- **Say this up front, because it's true today:** customers pay the restaurant directly (at pickup, on delivery, at the table). Online card payment isn't available yet. Marketplace connections aren't available yet.

## 3. Launch incentive: your decision, not part of the plan yet

Each option uses features that already exist. Pick one or none:

| Option | How it's set up | Cost to you |
|---|---|---|
| **A. Standard 14-day trial (default)** | Platform admin → restaurant → plan, assigned as a trial, or the owner self-serves at `/start-trial` | None |
| B. Longer free period for the first 10 restaurants (e.g. 30 or 60 days) | Platform admin → complimentary plan with that end date (manual subscription, no card) | That period's revenue |
| C. Founding-customer price (e.g. a lower monthly price for a year) | Platform admin → "offline" manual subscription at the agreed price, billed outside Paddle; or a Paddle discount code | The price difference. Offline billing also means invoicing them yourself. |

## 4. The process for each restaurant

### 4.1 Before contact (about 20 minutes per restaurant)
Creating a restaurant in the platform admin **requires the owner's email and sends them the invite straight away**, and the owner can't be changed afterwards. So don't create the prospect's real restaurant before they agree. Instead:

1. **Once:** create one **preview restaurant** owned by an email alias you control (e.g. `you+preview@…`), with Owner — Growth as a complimentary plan for your own use.
2. **Per prospect:** in that preview restaurant, rename it and import their public menu with menu import (PDF, photos or their website URL), and check prices and categories. Apply a theme and their colour. Publish it so you can show the live link.
3. **When they say yes:** create their **real** restaurant with **their** email (§4.3) and import the menu again there. The preview restaurant is then reused for the next prospect.

### 4.2 First contact (week-1 and week-2 cohorts)
Visit or call at a quiet hour (2–4 pm). Show the draft storefront with their own menu on your phone.

> Hi [name], I'm [you], from GarnishTable. I've put [restaurant]'s menu on a commission-free ordering page: here it is. Customers order straight from you, and you keep the whole order, with no per-order fee. If you like it, I'll publish it with you this week, and you can try it free for 14 days.

Leave the one-pager. Follow up the same day by WhatsApp or email with the draft link.

### 4.3 Onboarding call (30 minutes)
1. **Send the owner invite** from the platform admin. The owner sets their own password.
2. **Assign Starter or Growth as a 14-day trial** (Platform → the restaurant → plan). Growth if they want their own domain, analytics or promotions, or have 2 locations.
3. **Walk through together:** hours, pickup and delivery settings, delivery fee and minimum, then publish.
4. **Put the ordering link where customers already look:** their Google Business Profile, their Instagram bio, their website, and a table/counter QR code.
5. **Place one test order together and complete it from the kitchen screen.**

### 4.4 During the trial
| Day | Action |
|---|---|
| 2 | Check: any real orders? If none, help them post the link (Instagram story, table QR code). |
| 7 | Short call: what's working, what's missing. Fix one thing. |
| 11 | The product emails the owner automatically 3 days before the trial ends. Call the same day. |
| 12–14 | **Converting:** the owner subscribes from **Billing** in the app once Paddle approves `app.garnishtable.com`. Until then, they pay at `https://garnishtable.com/checkout` with the **same email** as their account, open the set-up link, sign in, and choose "Add plan to my account". The trial converts in place. This path is tested. |

Ask for annual (= 10 months' price) only when they're clearly happy.

## 4.5 Week 1, day by day (about 3 hours a day, no spend)

| Day | Do | Output by end of day |
|---|---|---|
| **Mon** | Pick the launch city (your decision). Set up the tracking sheet (§6). In the platform admin, create the reusable **preview restaurant** under an email alias you control and give it a complimentary Owner — Growth plan (§4.1). | City chosen; sheet ready; preview restaurant live |
| **Tue** | **Build the prospect list.** Search Google Maps for "restaurant", "pizza", "burgers", "takeaway", "café" in 3–4 neighbourhoods. For each independent with 1–2 locations, check its website, Google profile and Instagram for an ordering link. Add the ones with **no direct ordering link**, or only a marketplace link. | 50 prospects with name, address, contact, "ordering today" |
| **Wed** | **Prepare 10 previews.** For the 10 best prospects, import their public menu into the preview restaurant (menu import: website URL, PDF or photos), check prices, apply their colour, and screenshot it on a phone. You re-import for each prospect, so keep each screenshot. | 10 phone screenshots of "their" menu |
| **Thu** | **Visit 5 restaurants at 2–4 pm** (the quiet hours). Show their menu on the preview, use the opening line (§4.2), and leave the one-pager. Say up front what it doesn't do yet: online card payments, marketplace sync. | 5 conversations logged |
| **Fri** | **Visit 5 more.** Send same-day follow-ups to everyone met (WhatsApp or email, with the demo link `garnishtable.com/demo`). For anyone who said yes: book a 30-minute onboarding call (§4.3) for next week. | 10 contacted; follow-ups sent; any onboarding calls booked |
| **Sat** | Finish the list to 100 (another 50 from new neighbourhoods). Ask 2–3 friendly owners you met who else they know. | 100 prospects |
| **Sun** | **Review:** contacted, conversations, yeses, objections heard (write the exact words; they become FAQ entries). Prepare the next 10 previews. | Week-1 numbers in the sheet |

**Onboarding a "yes"** (§4.3, about 30 minutes, booked within 3 days):
- create their real restaurant with their email, which sends the invite;
- assign Starter or Growth as a **14-day trial**;
- import the menu;
- set hours, pickup and delivery;
- publish;
- put the link on their Google profile and Instagram;
- place one test order together.

**Converting at the end of the trial** (§4.4):
- the product emails them 3 days before the trial ends; call them that day;
- they subscribe from **Billing** once Paddle approves `app.garnishtable.com`;
- until then, they pay at `garnishtable.com/checkout` with the **same email**, then choose "Add plan to my account".

**The one number to watch each week:** trials that took a **real customer order** in their first 7 days. Those are the ones that convert.

## 5. Week by week

| Week | Activity | Target by end of week |
|---|---|---|
| 1 | Build the 100-restaurant list; prepare 10 draft storefronts; the first 10 visits | 10 contacted, 2 conversations |
| 2 | 20 more visits or calls (10 prepared the day before); onboard anyone who said yes | 30 contacted, 3 trials |
| 3 | 20 contacts; day-7 calls with week-2 trials | 50 contacted, 5 trials |
| 4 | 20 contacts; first conversions due (week-2 trials end) | 70 contacted, 7 trials, **1 paying** |
| 5 | 15 contacts; ask each happy trial for one referral | 85 contacted, 9 trials, 2 paying |
| 6 | 15 contacts; first testimonial and storefront example on the site | 100 contacted, 10 trials, 3 paying |
| 7 | Second list (50) or revisit warm no's | 4 paying |
| 8 | Close out remaining trials; review what converted and why | **5 paying** |

**Daily rhythm, about 3 hours:**
- prepare the next day's draft storefronts;
- make 4–5 contacts;
- send the follow-ups due;
- check every live trial's orders.

## 6. Tracking sheet

**Columns:** restaurant, neighbourhood, contact, ordering today (marketplace / phone / none), date contacted, outcome, draft storefront link, trial start, plan, orders in the trial, day-7 call done, converted (Y/N), plan and interval, reason if lost.

**Watch each week:**
- contacted → conversation → trial → published with a real order → paying;
- **Leading signal:** a trial that takes a real order in its first 7 days. Push every trial to get its first order.

## 7. What the platform already covers (no work needed)
- Admin creates restaurants and invites owners; trial, complimentary and offline plans; suspend, extend and cancel; audit trail.
- Menu import from PDF, photos or URL; themes; publishing.
- Owner trial reminder 3 days before the end; in-app billing (after Paddle approves the app domain); pay-now with "Add plan to my account".
- The live demo at `garnishtable.com/demo` (Wildwood Kitchen).
