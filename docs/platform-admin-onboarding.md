# Onboarding a restaurant as a platform admin

How GarnishTable staff set up a restaurant and its plan without the restaurant buying through the
public checkout. Everything here is in the admin app at **Platform → Restaurants** (and
**Platform → Agencies** for agency plans).

## 1. Create the restaurant and invite the owner

**Restaurants → Create restaurant.** Enter the restaurant name, its storefront slug, and the
owner's name and email, then **Create restaurant & send invite**.

- This creates the business, the restaurant (status *pending*, not visible to customers) and the
  owner's account with no password. The owner gets an email with a one-time link to set their own
  password. No password is ever created or shown to you.
- An email that already belongs to an account, or a slug already in use, is refused.
- If the email didn't arrive, use **Resend invite** on the Restaurants list.

## 2. Give it a plan

Open the restaurant (click its name). The **Plan & billing** card shows where the plan is billed
and offers **Set up a plan**:

| Choice | What it means | Payment taken by GarnishTable |
|---|---|---|
| **Complimentary** | Free for the term you set (e.g. a launch partner). | None, ever |
| **Billed offline** | You invoice the restaurant yourself. Defaults to the plan's list price; type a negotiated price if agreed. | None — the agreement is recorded, never a payment |
| **Free trial** | The plan's trial with no card; the owner subscribes through checkout before it ends. | Only when the owner checks out |

Complimentary and offline plans have an explicit **start** (today or earlier) and **end** date.
Access to the plan's features stops at the end date unless you extend it — nothing renews
automatically and no billing provider is ever contacted. The optional admin note is visible only
to platform admins.

List prices: Owner Starter $59/month or $590/year · Owner Growth $99/month or $990/year ·
Agency Growth $179/month or $1,790/year. There is no per-order commission.

## 3. Manage it afterwards

On a complimentary or offline plan:

- **Extend** — move the end date later.
- **Change plan** — another plan or interval (and, for offline, the agreed price). Dates stay.
- **Suspend / Unsuspend** — features stop immediately and come back on unsuspend. The owner sees
  the reason you enter.
- **Cancel plan** — at the end of the term, or immediately. **Resume** withdraws a scheduled
  cancellation.

A **free trial** can be replaced by a complimentary or offline plan in place, or ended.

A plan **paid through Lemon Squeezy** belongs to the owner's billing page: you can only schedule
its cancellation at the end of the period they've paid for. To move a paying restaurant to a
manual plan, cancel the paid one first.

## What the owner sees

Their **Billing** page shows the plan as *managed by GarnishTable* (complimentary, or the agreed
price invoiced by GarnishTable) with no checkout, card or cancel buttons — the API refuses those
actions too. If you suspend the plan, or it reaches its end date, they see a notice asking them
to contact support.

## Records

- **Billing history** (bottom of the Plan & billing card) lists every change. Manual plans never
  produce "Payment received" rows.
- **Audit log** — every plan action is recorded on the restaurant's audit log (or the agency's),
  naming the admin who did it.
- **Platform → Subscriptions** shows every plan and where it is billed; the revenue figures count
  an offline plan at its agreed price and a complimentary one at nothing.
