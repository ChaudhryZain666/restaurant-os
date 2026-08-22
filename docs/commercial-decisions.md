# Commercial / Billing Decisions — Not Yet Made

This document exists so billing isn't built on invented business rules. Every item below is a
real decision the business needs to make before a billing system can be implemented — not an
architecture question. Nothing here is implemented; `Restaurant.status` (`pending`/`active`/
`suspended`) is the only billing-adjacent field that currently exists, and it's set manually by a
platform admin today, not by any subscription/payment logic.

## Decisions required

| Decision | Why it blocks implementation |
|---|---|
| **Trial length** | No duration is configured anywhere in the codebase (confirmed by repo-wide search — see the marketing Start Free Trial page, which deliberately doesn't state a number). A trial-expiry job/state machine can't be built without knowing what it's counting down. |
| **Free plan or trial-only** | Determines whether `Restaurant.status` needs a permanent `"free"` tier or just `"trial"` → `"active"`/`"suspended"`. |
| **Monthly price** | Needed for the invoice/charge amount and any proration logic. |
| **Annual price / discount** | Needed if annual billing is offered at all — affects whether billing cycles are even a variable or a constant. |
| **Order commission vs. flat SaaS fee (vs. both)** | This is an architecture-defining choice, not a detail: a commission model needs the platform to see/verify order totals for billing purposes (it already can, via `Order.total`), while a flat-fee model needs none of that. A hybrid needs both. Picking late is fine; building against the wrong one isn't. |
| **Restaurants-per-account / locations limit** | Determines whether `createRestaurant` needs a plan-aware guard rail before a real self-service signup flow exists (today it's platform-admin-only, so this isn't urgent, but multi-location is explicitly out of scope for this phase too). |
| **Feature gating by plan** | E.g. is Promotions/Loyalty/Staff-management available on every plan, or gated? Affects whether RBAC's existing permission system (`packages/types/src/types/rbac.ts`) needs a plan dimension added alongside role, or whether a separate `entitlements` concept is needed. |
| **Cancellation behavior** | Immediate data lock vs. grace period vs. export window. Determines whether `Restaurant.status` needs a `"cancelling"` state distinct from `"suspended"`. |
| **Expired-trial behavior** | Hard lockout vs. read-only vs. degraded (e.g. storefront stays live, admin portal locks). Determines what `computeAvailability` (`apps/api/src/services/restaurantAvailability.service.ts`) needs to check, since that's the existing single source of truth for "can this restaurant take orders right now." |
| **Failed-payment behavior** | Retry schedule, dunning emails (this phase's new `EmailService` is the right seam for those once a provider exists), and how many failures before suspension. |

## What already exists that a future billing phase can build on

- **`Restaurant.status`** (`pending`/`active`/`suspended`) — the natural home for whatever
  trial/subscription state machine gets decided, without a schema migration to add the concept of
  "restaurant can/can't operate."
- **`EmailService`** (`apps/api/src/email/`) — the transactional-email abstraction that
  trial-ending, payment-failed, and receipt emails would use. As of Phase 15, `SmtpEmailService`
  (Nodemailer) is real, working code behind `EMAIL_PROVIDER=smtp` — but it has never sent a real
  message in this environment (no SMTP credentials were available); see that module's doc-comments.
  Which real SMTP relay/provider to use in production is still an open decision, separate from the
  business rules above.
- **`computeAvailability`** — already the single place order-acceptance is decided. Billing state
  should plug into this function rather than duplicating an "is this restaurant allowed to operate"
  check somewhere else.
- **Server-authoritative order pricing** (`orderPricing.service.ts`) — if a commission model is
  chosen, `Order.total` is already computed and stored server-side per order, so a commission
  calculation has real numbers to work from without trusting anything client-supplied.

## What this phase deliberately did not build

No `Subscription`/`Plan`/`Invoice` model, no payment-provider integration, no trial-countdown job,
no plan-based feature gating. Building any of these against undecided business rules would mean
either inventing the rules (explicitly disallowed) or building something that has to be thrown
away once real rules are decided.
