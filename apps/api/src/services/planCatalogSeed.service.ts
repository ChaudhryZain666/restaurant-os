import { Plan } from "../models/Plan.js";

/**
 * Phase 43 — extracted verbatim from scripts/seed.ts so the commercial catalog can be seeded (and
 * tested) independently of any demo/admin account creation. This is the ONLY thing the production
 * seed path (scripts/seed.ts) does — see that file's own header comment. Nothing in this function
 * creates a User, Restaurant, or Business document.
 *
 * Phase 24 established the Plan catalog structurally. Phase 27 populated PROPOSED pricing on
 * "owner"/"agency". Phase 34 supersedes that pricing with a real commercial decision
 * (docs/commercial-decisions.md) — Basic/Pro/Agency-tier plans below — WITHOUT deleting or
 * price-mutating the original two documents: `Subscription.planId` is a live, non-snapshotted FK
 * (resolveOwnerPlan/getPlanForSubscription dereference Plan fresh on every check), so any
 * existing subscriber still pointed at "owner"/"agency" must keep seeing exactly the terms they
 * signed up under, forever. "owner"/"agency" are instead flipped isActive:false below — new
 * signups can never select them (createSubscriptionCore/createCheckoutSessionCore both filter
 * `Plan.findOne({code, isActive:true})`), but they remain valid FK targets for existing
 * subscriptions AND for subscriptionBackfill.service.ts's grandfather logic, which resolves
 * `Plan.findOne({code:"owner"})` with no isActive filter at all.
 *
 * All upserts use $setOnInsert (never $set) so re-running this never clobbers a catalog that's
 * since been hand-edited — the same precedent Phase 25/27 established for this exact shape.
 */
export async function seedPlanCatalog(): Promise<void> {
  await Plan.findOneAndUpdate(
    { code: "owner" },
    {
      $setOnInsert: {
        code: "owner",
        name: "Owner",
        type: "OWNER",
        description: "For a single restaurant or a small multi-location group you run yourself.",
        pricing: [
          { interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_owner_monthly" },
          { interval: "yearly", amountCents: 79000, currency: "USD", providerPriceId: "mock_price_owner_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_locations", value: 1 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency" },
    {
      $setOnInsert: {
        code: "agency",
        name: "Agency",
        type: "AGENCY",
        description: "For an agency managing multiple client restaurant businesses.",
        pricing: [
          { interval: "monthly", amountCents: 19900, currency: "USD", providerPriceId: "mock_price_agency_monthly" },
          { interval: "yearly", amountCents: 199000, currency: "USD", providerPriceId: "mock_price_agency_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 5 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  // Retired from new signups the moment Phase 34's replacement tiers exist — never deleted, never
  // price-mutated (see the block comment above). A no-op $set on a doc that's already isActive:false
  // (e.g. a second seed run) — Mongoose update, not $setOnInsert, since this one genuinely needs to
  // apply to an already-existing document, not only a freshly-inserted one.
  await Plan.updateMany({ code: { $in: ["owner", "agency"] } }, { $set: { isActive: false } });

  // Phase 34 — the real Basic/Pro/Agency-tier catalog (docs/commercial-decisions.md's updated
  // pricing table). Included-location/business counts and per-tier feature gating are a defaulted,
  // reasonable starting point flagged in the final report as a product-numbers decision, not a
  // hidden assumption — same PROPOSED-until-confirmed honesty convention as the plans above.
  await Plan.findOneAndUpdate(
    { code: "owner_basic" },
    {
      $setOnInsert: {
        code: "owner_basic",
        name: "Basic",
        type: "OWNER",
        description: "Core online ordering for a single restaurant location.",
        pricing: [
          { interval: "monthly", amountCents: 1500, currency: "USD", providerPriceId: "mock_price_owner_basic_monthly" },
          { interval: "yearly", amountCents: 15000, currency: "USD", providerPriceId: "mock_price_owner_basic_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: false },
          { key: "business_analytics", value: false },
          { key: "business_promotions", value: false },
          { key: "max_locations", value: 1 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "owner_pro" },
    {
      $setOnInsert: {
        code: "owner_pro",
        name: "Pro",
        type: "OWNER",
        description: "Multi-location ordering with custom domains, analytics, and promotions.",
        pricing: [
          { interval: "monthly", amountCents: 2900, currency: "USD", providerPriceId: "mock_price_owner_pro_monthly" },
          { interval: "yearly", amountCents: 29000, currency: "USD", providerPriceId: "mock_price_owner_pro_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_locations", value: 3 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency_starter" },
    {
      $setOnInsert: {
        code: "agency_starter",
        name: "Agency Starter",
        type: "AGENCY",
        description: "For an agency managing up to 5 client businesses.",
        pricing: [
          { interval: "monthly", amountCents: 9900, currency: "USD", providerPriceId: "mock_price_agency_starter_monthly" },
          { interval: "yearly", amountCents: 99000, currency: "USD", providerPriceId: "mock_price_agency_starter_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 5 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency_growth" },
    {
      $setOnInsert: {
        code: "agency_growth",
        name: "Agency Growth",
        type: "AGENCY",
        // Real volume economics: $99/5 businesses (Starter) vs. $249/15 (Growth) — a genuinely
        // lower per-business rate at higher volume, not just a bigger flat number.
        description: "For a larger agency managing up to 15 client businesses, at a lower per-business rate.",
        pricing: [
          { interval: "monthly", amountCents: 24900, currency: "USD", providerPriceId: "mock_price_agency_growth_monthly" },
          { interval: "yearly", amountCents: 249000, currency: "USD", providerPriceId: "mock_price_agency_growth_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 15 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  // Retired from new signups the moment Phase 39's approved catalog exists — same non-destructive
  // mechanism as the owner/agency -> owner_basic/owner_pro/agency_starter/agency_growth transition
  // above: flip isActive:false, never delete, never mutate pricing. Subscription.planId is a live,
  // non-snapshotted FK, so every existing $15/$29/$99/$249 subscriber keeps seeing exactly the terms
  // they signed up under, forever — see docs/commercial-decisions.md's Phase 39 section.
  await Plan.updateMany({ code: { $in: ["owner_basic", "owner_pro", "agency_starter", "agency_growth"] } }, { $set: { isActive: false } });

  // Phase 39 — the founder-approved commercial catalog (docs/commercial-decisions.md's Phase 39
  // section). Unlike the Phase 34 tiers, these prices/limits are an explicit founder decision, not a
  // defaulted starting point.
  await Plan.findOneAndUpdate(
    { code: "owner_starter" },
    {
      $setOnInsert: {
        code: "owner_starter",
        name: "Owner — Starter",
        type: "OWNER",
        description: "Core online ordering for a single restaurant location.",
        pricing: [
          { interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: "mock_price_owner_starter_monthly" },
          { interval: "yearly", amountCents: 59000, currency: "USD", providerPriceId: "mock_price_owner_starter_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: false },
          { key: "business_analytics", value: false },
          { key: "business_promotions", value: false },
          { key: "max_locations", value: 1 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "owner_growth" },
    {
      $setOnInsert: {
        code: "owner_growth",
        name: "Owner — Growth",
        type: "OWNER",
        description: "Multi-location ordering with custom domains, analytics, and promotions.",
        pricing: [
          { interval: "monthly", amountCents: 9900, currency: "USD", providerPriceId: "mock_price_owner_growth_monthly" },
          { interval: "yearly", amountCents: 99000, currency: "USD", providerPriceId: "mock_price_owner_growth_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_locations", value: 2 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
  await Plan.findOneAndUpdate(
    { code: "agency_growth_v2" },
    {
      $setOnInsert: {
        code: "agency_growth_v2",
        name: "Agency — Growth",
        type: "AGENCY",
        description: "For an agency managing up to 5 client businesses, each inheriting Growth-tier entitlements.",
        pricing: [
          { interval: "monthly", amountCents: 17900, currency: "USD", providerPriceId: "mock_price_agency_growth_v2_monthly" },
          { interval: "yearly", amountCents: 179000, currency: "USD", providerPriceId: "mock_price_agency_growth_v2_yearly" },
        ],
        entitlements: [
          { key: "custom_domains", value: true },
          { key: "business_analytics", value: true },
          { key: "business_promotions", value: true },
          { key: "max_businesses", value: 5 },
          // Phase 39 — a managed business with no subscription of its own inherits THIS plan's
          // entitlements (entitlementLimit.service.ts's resolveBusinessPlanWithInheritance). This
          // key is deliberately distinct from max_locations (which only applies to a direct OWNER
          // subscription) so it's never confused with this plan's own max_businesses above. Set to
          // match Owner Growth's included-location count, since "Agency Growth" is defined as
          // granting Growth-tier entitlements to every managed business (founder spec, Phase 39 §12)
          // — this is the explicit, documented interpretation of "the appropriate location
          // entitlement," which the spec named by tier but did not number directly.
          { key: "managed_business_max_locations", value: 2 },
        ],
        isActive: true,
      },
    },
    { upsert: true }
  );
}
