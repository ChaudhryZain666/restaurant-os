# Entitlement Architecture Reference

The single, authoritative reference for "what is this user/business/agency allowed to do right now,
and why." Written during the Phase 61 audit, consolidating (not replacing) the historical narrative
in `docs/commercial-decisions.md` (pricing/billing decisions) and
`docs/multi-tenant-storefront-architecture.md` (the broader multi-tenant system). This file is the
one to read first for entitlements specifically; those two remain the record of how each piece got
there and why.

## 1. The one authoritative resolution path

All entitlement resolution — feature flags and numeric limits alike — goes through
`entitlementLimit.service.ts`. No controller, route, or page independently re-derives "is this
business agency-managed" or "what plan applies" — every caller either calls this service directly or
goes through its `requireEntitlement` Express middleware.

```
resolveBusinessPlanWithInheritance(businessId):
  1. business's own subscription history:
       live now                                                -> that plan applies, always wins
       real history, but not live (Phase 63: "lapsed")          -> DENY features, FREEZE capacity
       no history at all                                        -> check the agency (step 2)
  2. only reached if the business has NEVER had its own subscription:
       agency-inherited, if Business.agencyId is set and the
       agency's subscription history is live now                -> agency plan applies
       agency has real history, but not live ("lapsed")          -> DENY features, FREEZE capacity
       agency also has no history at all                         -> generous no-subscription default
```

"Live" = `status` is `active`, `past_due`, or `cancelling`; OR `status` is `trialing` AND `trialEnd`
has not yet passed (Phase 63 — see §13 below for why the trialing case needs its own boundary check,
not just a status-in-list test). Always excludes `provider === "internal"`. This whole "live" concept
— plus the "lapsed vs. never" distinction — is centralized in
`subscriptionResolution.service.ts` (`isSubscriptionLive`, `resolveSubscriptionState`), imported by
`entitlementLimit.service.ts`, `agencyEntitlement.service.ts`, and `subscription.service.ts` alike —
never redefined per call site.

This is a pure, uncached function of `businessId` alone. It does not know or care whether the caller
is the agency, the restaurant owner, or staff — the same business resolves to the same entitlements
regardless of who is asking (Step 4/8's "owner login cannot accidentally override agency entitlement"
is satisfied structurally, not by a special case: there is no code path where the caller's own
identity feeds into which plan a *business* resolves to).

## 2. Authoritative context matrix

| Context | Subscription source | Entitlement source |
|---|---|---|
| Independent owner's Business (no `agencyId`) | The Business's own `Subscription` | Owner-type Plan |
| Agency itself (its own resources: Team, Billing, Activity) | The Agency's own `Subscription` | Agency-type Plan |
| Agency-managed Business, no subscription of its own | The managing Agency's `Subscription` | Agency-type Plan's managed-business entitlements |
| Agency-managed Business WITH its own subscription | The Business's own `Subscription` | Owner-type Plan (wins over the agency's, unconditionally) |
| Restaurant Owner logged into an agency-managed Business | Same as the row above — identical to what the Agency sees | Same — resolution has no owner-vs-agency branch |
| Staff logged into any Business | Same as the Business's own row above, gated further by role permissions | Same |
| Platform Admin | N/A — platform routes bypass business-scoped entitlement entirely | Platform-level RBAC (`platform_admin` role), unrelated to this system |

## 3. Two distinct entitlement key namespaces

An Agency-type Plan expresses a managed business's location allowance under a **different key**,
`managed_business_max_locations`, never the Owner-type `max_locations` key — so an agency's own
`max_businesses` (how many client businesses IT can create) is never confused with what it grants
each managed business. A legacy agency plan seeded before this key existed (`agency_starter`,
`agency_growth`) has no `managed_business_max_locations` at all, and falls through to the generous
default rather than the more surprising interpretation of "0 locations allowed."

## 4. Enforcement inventory — every entitlement key, where enforced, where displayed

| Key | Kind | Server enforcement | Client UI |
|---|---|---|---|
| `custom_domains` | boolean | `restaurantDomain.routes.ts`'s domain-creation route, `requireEntitlement("custom_domains", "restaurantId")`; also enforced at resolution time by `getRestaurantByDomain` (`restaurant.controller.ts`) so a previously-active domain stops resolving once the owning business lapses | `DomainSettingsPanel.tsx` — locked "Requires an active plan" state via `useBusinessEntitlements`; a still-active domain row shows a "currently unavailable to customers" note instead of silently keeping its "Active" badge |
| `business_analytics` | boolean | `businessAnalytics.routes.ts`, `requireEntitlement("business_analytics")` | `BusinessAnalyticsPage.tsx` — same pattern |
| `business_promotions` | boolean | `businessPromotion.routes.ts`, `requireEntitlement("business_promotions")` | `BusinessPromotionsPage.tsx` — same pattern |
| `max_locations` (Owner) | numeric | `entitlementLimit.service.ts`'s `reserveLocationSlot` — atomic `findOneAndUpdate` guard, called by `createLocationForBusiness`/`createRestaurant` before their own transaction | `LocationsPage.tsx`'s pre-check (`GET .../locations/limit`) disables "Add another location"; server is the real guard |
| `managed_business_max_locations` (Agency) | numeric | Same `reserveLocationSlot`, resolved via the agency-inheritance path | Same UI, same pre-check endpoint |
| `max_businesses` (Agency) | numeric | `agencyEntitlement.service.ts`'s `reserveBusinessSlot` — atomic guard, called by `createAgencyBusiness` before its own transaction | `AgencyBusinessesPage.tsx` disables "New client" at the limit |

No other entitlement keys exist in the repository today — menu, ordering, delivery, and POS
functionality are **not** gated by this system at all (they are gated by RBAC permissions only,
e.g. `restaurant.menu.write`), a deliberate, unchanged design: the entitlement system governs paid
*growth* features and capacity, not core operability.

Deep-link/API bypass protection: every boolean key's real authority is the `requireEntitlement`
Express middleware (chained after tenant/permission middleware), never the frontend hook — confirmed
via `agency.controller.test.ts`'s and `entitlementLimit.service.test.ts`'s direct-HTTP tests, which
call the routes without going through any UI at all.

## 5. Subscription states (`Subscription.status`, the actual schema enum)

`trialing | active | past_due | cancelling | cancelled | expired`

(Note: the codebase uses the double-`l` spelling `cancelling`/`cancelled` throughout — there is no
separate `canceled`/`incomplete`/`unpaid` state; those don't exist in this schema. `past_due` is a
real state with defined behavior below, not a placeholder.)

| Status | Meaning | Entitlement effect |
|---|---|---|
| `trialing` | No-card trial in progress | **Live** — full plan entitlements apply, identical to `active` |
| `active` | Real, current paid period | **Live** — full plan entitlements apply |
| `past_due` | A payment failed; provider dunning in progress | **Live** — full access continues (never treated as cancelled the instant one payment fails; see `docs/commercial-decisions.md` §10) |
| `cancelling` | Cancellation scheduled at period end | **Live** — entitlements continue through the already-paid period (the grace period, reusing this same state rather than inventing a second lifecycle) |
| `cancelled` | Terminal, voluntarily ended | **Not live.** Phase 63: this owner now has real subscription history that isn't live — resolution treats it as **"lapsed"**, denying features and freezing capacity (§6) — never the generous no-subscription default. |
| `expired` | Terminal, involuntarily ended (trial lapsed, or provider gave up dunning) | **Not live** — same "lapsed" treatment as `cancelled`. |

At most one live subscription per owner is enforced by a real partial unique DB index on
`{ownerType, ownerId}` (scoped to the four live statuses) — not just application discipline.
Re-subscribing after `cancelled`/`expired` always creates a **new** `Subscription` document; the old
one is preserved as financial history, never resurrected or deleted.

## 6. The "no subscription" default vs. "lapsed" — what each is and isn't

**Genuinely never subscribed** ("never" — resolution reaches the end of the chain having found zero
real `Subscription` documents anywhere): the system applies a generous, explicitly non-commercial
default — boolean features default to `true`, `max_locations` defaults to 20, `max_businesses`
defaults to 3. This is **not** a loophole — it is a deliberate, founder-documented decision
(`docs/commercial-decisions.md` §6, §19) that exists so the platform never retroactively breaks a
real, pre-existing grandfathered account (verified against real observed data — a demo account with
9 real locations predates any commercial catalog). Unchanged by Phase 63.

**Had a real subscription, not live now** ("lapsed" — Phase 63's critical fix): an expired trial, or
a cancelled/expired paid subscription, is a fundamentally different case from "never subscribed" and
must never be treated the same way. Before Phase 63, resolution conflated the two — both hit the same
`null` result and got the same generous default, meaning an expired trial silently kept full paid
entitlements forever. Now:
- every boolean feature entitlement resolves to **`false`** (denied) — never a specific plan's number,
  purely "no live paid entitlement grants this"
- every numeric limit (`max_locations`, `max_businesses`) is **frozen at current usage** — the exact
  count already on the `Business`/`Agency` document, so nothing existing is ever touched, deleted, or
  disabled, but no further growth is possible without a live subscription

This is a deliberately *technical*, non-commercial floor — never a specific plan's Starter/Growth
number copied in as "the" post-trial policy (that remains an open founder decision, §14). The "lapsed"
vs. "never" distinction is decided in one place, `subscriptionResolution.service.ts`'s
`resolveSubscriptionState`, by finding the most recent real (`provider !== "internal"`) subscription
for the owner regardless of status: none found → "never"; found and live → "live"; found and not live
→ "lapsed". `provider: "internal"` (grandfathered/comped) subscriptions are excluded from this check
entirely, so an owner whose only-ever subscription was "internal" still resolves as "never" — the
existing grandfathering guarantee is completely unaffected by this fix.

## 7. `AgencyMembership` — access, never ownership

`AgencyMembership` (a separate collection, never an array field on `User`) grants an agency member
the ability to *act on* a managed business, gated by `AGENCY_ROLE_GRANTS` (a site-wide `Permission`
vocabulary reused, not duplicated) and server-verified per request via `requireBusinessMatch`/
`requireTenantMatch`'s agency branch. It never changes `Business.ownerId`, never creates a second
owner identity, and is structurally incapable of feeding into entitlement resolution (§1 above)
since that function only ever takes a `businessId`, never a `userId`. Verified directly:
`agencyEntitlementInheritance.service.test.ts`'s ownership-preservation test proves a newly
agency-provisioned business's `ownerId` is the real new owner user, never the agency or any agency
member.

## 8. `ClientCommercialTerms` — informational only, never an entitlement source

A `ClientCommercialTerms` document records what an agency *charges its own client* for the agency's
services (plan label, price, currency, billing cycle, status, trial dates, notes) — one per business,
maintained entirely at the agency's discretion. It is read by exactly one place
(`AgencyBusinessDetailPage.tsx`'s Commercial card) and written by exactly one endpoint
(`PUT /agencies/:agencyId/businesses/:businessId/commercial-terms`). It:

- is **never** read by `entitlementLimit.service.ts` or any `requireEntitlement` check
- creates no `Subscription`, no `BillingHistoryEvent`, no provider charge, no invoice
- cannot grant or restrict any platform capability, regardless of its own `status`/`priceAmountCents`
- is explicitly labeled in the UI ("This records what your agency charges this client for your
  services — it is not collected by the platform, and it never changes what the platform charges
  you") so it is never mistaken for real billing

Grep-verified: no import of `ClientCommercialTerms` exists anywhere under
`entitlementLimit.service.ts`, `agencyEntitlement.service.ts`, `subscription.service.ts`, or any
`requireEntitlement`-gated route.

## 9. Agency lifecycle — explicit behavior

| Event | Behavior |
|---|---|
| Agency starts a trial | Real `Subscription` (`status: "trialing"`), no billing provider contacted, no fake invoice. Managed businesses immediately inherit the trial plan's entitlements (proven: `agencyEntitlementInheritance.service.test.ts`, `agency.controller.test.ts`'s new trial-capacity test). |
| Agency subscribes (active) | Normal operation, full plan entitlements. |
| Agency reaches `max_businesses` | New provisioning blocked server-side with a clean `409`, atomically (`reserveBusinessSlot`) — safe under real concurrency (proven: `Promise.all` race tests in both `entitlementLimit.service.test.ts`-style and `agency.controller.test.ts`). |
| Agency cancels (`cancelling`) | Existing managed businesses keep inherited entitlements through the already-paid period — the built-in grace period, no second lifecycle invented. |
| Agency subscription reaches `cancelled`/`expired` | Inheritance stops immediately (next read of `resolveBusinessPlanWithInheritance` no longer finds a live agency subscription). **Phase 63 correction**: managed businesses with no subscription of their own now resolve to **"lapsed"** — features denied, location count frozen at current usage — never the generous no-subscription default (that was the exact bug Phase 63 fixed; the original Phase 61 version of this table, and of the tests proving it, asserted the opposite). A managed business WITH its own separate live subscription is entirely unaffected either way. The agency's OWN capacity to create *more* businesses is frozen at its current `businessCount` the same way (`agencyEntitlement.service.ts`'s `getMaxBusinesses`) — proven: `agency.controller.test.ts`'s expired-agency test creates one business while active, then confirms a second attempt 409s post-expiry and the existing one is untouched. |
| Agency downgrades to a lower tier while over the new `max_businesses`/location count | `changeSubscriptionPlanCore` only swaps `Subscription.planId` and records a billing-history event — it never iterates, disables, or deletes existing `Business`/`Restaurant` documents. Existing managed businesses continue operating unaffected; only **new** provisioning becomes blocked until usage drops below the new limit (or the agency upgrades again). Confirmed by direct code read — no code path exists that would touch existing businesses on a plan change. |
| A Business leaves its Agency (`Business.agencyId` cleared) | Inheritance stops the moment the relationship stops (step 2 of §1 can no longer find an agency). The business's own resolution then depends on ITS OWN subscription history — "lapsed" if it ever had one, "never" (generous default) if it genuinely never did. `ownerId` is never touched, no charge of any kind occurs. **No dedicated "leave agency" endpoint exists yet** — today this state change is data-level only (e.g. a future platform-admin action); the audit tested the entitlement *consequence* of the transition, which is already correct and stateless, without building new relationship-management UI (a deliberate scope decision, not an oversight — see the Phase 60 report). |
| A trial (owner or agency) reaches its real `trialEnd` boundary | **Phase 63 — the mechanism that was entirely missing before this phase.** See §13 below: nothing autonomously moved a `"trialing"` subscription to `"expired"` until now. |

## 10. Caching

**There is no entitlement cache.** `resolveBusinessPlanWithInheritance` and every function built on
it perform a plain, uncached Mongoose read on every call. Grep-verified: no Redis reference exists
anywhere in `entitlementLimit.service.ts` or `agencyEntitlement.service.ts`. This means a subscription
status change, plan change, or agency-membership change is reflected on the *very next* request —
there is no staleness window and nothing to invalidate. No caching layer was introduced this phase
(the brief's own instruction: do not add one merely for this phase).

## 11. Plan catalog — reported exactly as found, nothing invented or changed

Live-queried directly from the database during this audit (not from memory or documentation):

**Active (selectable by new subscriptions):**

| Code | Type | Monthly | Yearly | Key limit | Feature entitlements |
|---|---|---|---|---|---|
| `owner_starter` | OWNER | $59.00 | $590.00 | `max_locations: 1` | custom_domains: false, business_analytics: false, business_promotions: false |
| `owner_growth` | OWNER | $99.00 | $990.00 | `max_locations: 2` | all three: true |
| `agency_growth_v2` | AGENCY | $179.00 | $1,790.00 | `max_businesses: 5`, `managed_business_max_locations: 2` | all three: true (inherited by every managed business) |

**Inactive (retained, never deleted or price-mutated — the correct FK target for any historical
subscriber, `Subscription.planId` is a live reference, never a snapshot):** `owner` ($79/$790, 1
location), `owner_basic` ($15/$150, 1 location), `owner_pro` ($29/$290, 3 locations), `agency`
($199/$1990, 5 businesses), `agency_starter` ($99/$990, 5 businesses), `agency_growth` ($249/$2490,
15 businesses).

Trial length: no per-plan `trialDays` override is set on any current plan — all fall back to
`env.TRIAL_PERIOD_DAYS` (14 days, per `docs/commercial-decisions.md` §5, still explicitly marked
**PROPOSED**, not a final founder sign-off — unchanged, undecided, not this phase's call).

No pricing, limits, or entitlement keys were changed by this phase's audit.

## 12. A real, found-and-fixed data hygiene bug (Phase 61)

The Phase 59 audit's own E2E spec (`e2e/agency-entitlement-inheritance.spec.ts`) seeded a real,
`isActive: true` AGENCY-type Plan directly via MongoDB to test a restrictive scenario, but never
deleted it — leaking real "Test Plan" pollution into the live `/public/plans` catalog on every run
(5 such documents had already accumulated in this dev database by the time this phase's audit found
them). Fixed: the spec now tracks and deletes its own seeded `Plan`/`Subscription` documents in
`afterAll`, matching the established convention (`e2e/agency-management.spec.ts`'s own Phase 40.1
fix, `apps/api/src/scripts/cleanupOrphanedTestPlans.ts`). The 5 already-polluted documents were
removed from this dev database directly; re-verified the real catalog now shows only the intended
active plans.

## 13. Trial expiration — the autonomous mechanism Phase 63 added

**The critical finding**: before Phase 63, nothing in this codebase ever transitioned a `"trialing"`
subscription to `"expired"` except a real billing provider's webhook explicitly reporting the trial
ended unconverted (`subscription.service.ts`'s `resolveTransitionTarget`). That trigger has never
fired once, in any environment (dev, test, or this project's own history), because no environment has
ever had a live, connected provider. The practical consequence: every trial ever created stayed
`"trialing"` — a **live** status carrying full plan entitlements — forever, regardless of how much
real time had passed, as long as nobody manually intervened.

**The fix has two, deliberately independent, halves**:

1. **Real-time boundary correctness** (`subscriptionResolution.service.ts`'s `isSubscriptionLive`):
   a `"trialing"` subscription whose `trialEnd` has already passed is treated as NOT live the instant
   that boundary is crossed — checked fresh on every entitlement/capacity read, using an explicit
   `now` parameter for exact, deterministic testability (no fake timers needed — see that file's own
   tests). This is what actually keeps entitlement decisions correct; it does not depend on any
   background job's cadence.
2. **Eventual persistence** (`subscription.service.ts`'s `runTrialExpirationSweep`, registered as the
   repeatable job `billing.trial_expiration_tick` every 15 minutes, `notification.queue.ts`): finds
   every `"trialing"` subscription whose `trialEnd` has passed and atomically transitions it to
   `"expired"` (guarded by `status: "trialing"` in the update filter, so a real concurrent conversion
   or cancellation can never be clobbered), recording a `BillingHistoryEvent`. This exists so the
   document's own `status` field — read by billing history, the admin/billing-page display, and any
   future real provider webhook expecting the prior state — eventually reflects reality too. It is
   bookkeeping, not the source of entitlement correctness.

**Boundary semantics**: the boundary is exclusive of `trialEnd` itself — live up to (not including)
that exact instant, expired from that instant forward. No off-by-one-day or off-by-one-second
behavior; proven directly against the millisecond via `isSubscriptionLive`'s own `now` parameter,
never a wall-clock-dependent test.

**A converted (now `"active"`) subscription is never touched** by the sweep or by the boundary check
— both only ever look at `status === "trialing"`; a subscription that has already converted has no
`"trialing"` status left to match, so a stale historical `trialEnd` is simply irrelevant to it. Proven
directly (`subscription.service.test.ts`).

## 14. UI/API consistency — a real gap the Phase 63 fix itself exposed

Fixing the backend resolver alone was not sufficient. `useBusinessEntitlements.ts` (the shared React
hook behind `DomainSettingsPanel.tsx`, `BusinessAnalyticsPage.tsx`, and `BusinessPromotionsPage.tsx`)
had its own, independent fallback rule — `if (!entitlements) return true` — written before the
"lapsed" concept existed. Both `source: "default"` (never subscribed) and the new `source: "lapsed"`
return `entitlements: null` from the API, and the hook could not tell them apart: it kept showing a
fully-unlocked page for a lapsed business even though the server's own `requireEntitlement` middleware
would already reject the same action with a real 403. Live-reproduced (a real browser E2E run showed
the Domains tab silently unlocking after an agency subscription expired) before being fixed. The hook
now checks `source === "lapsed"` explicitly and denies first, so it can never again disagree with the
server it exists to preview.

## 15. Founder decisions still open (not resolved by this or any prior audit phase)

Carried over, unchanged, from `docs/commercial-decisions.md` — listed here for entitlement-specific
visibility, not re-litigated:

- Final trial length (currently 14 days, marked PROPOSED).
- Whether a payment method should ever be required up front for either Owner or Agency plans.
- Additional-location/additional-business self-serve purchasing beyond a plan's included count
  (architecture supports the underlying counters; no purchase flow exists).
- Whether a dedicated "leave agency" action should ever be built (currently data-level only, §9).
- The exact `past_due` grace-period length as a product policy (the mechanism already exists and is
  safe; the number is not yet a commercial decision).
- **New (Phase 63)**: the exact *post-trial/post-cancellation experience* beyond "no paid features,
  no further growth" is a real, open founder decision — e.g. whether an expired-trial owner should see
  a dedicated "reactivate" screen, a read-only mode banner, or a specific messaging treatment. The
  technical floor (§6's "lapsed" behavior) is implemented and safe regardless of what UX is layered on
  top of it later.
