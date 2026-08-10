# Roadmap

## Phase 0 (this phase) — Foundation

Multi-tenant data model, RBAC, versioned API with a consistent response envelope, Swagger docs,
structured logging, BullMQ + Socket.IO + storage foundations, Docker dev environment, test
setup, lint/format config, docs. Explicitly *not* built: full menu/product management UI, cart,
checkout UI beyond what already existed, the full order engine, payments, delivery, promotions,
AI features, WhatsApp, analytics dashboards, subscription billing, white-labeling.

## Known Phase 0 simplifications (carried forward on purpose, not oversights)

- **Storefront serves one hardcoded restaurant** (`apps/web`'s `RestaurantContext` resolves a
  restaurant by a fixed slug from `VITE_RESTAURANT_SLUG`). Real multi-restaurant storefront
  routing — custom domains, `restaurant.platform.com/menu`-style paths, or a restaurant picker —
  is Phase 1+ work; building it now would be UI work ahead of the business logic that needs it.
- **No self-service restaurant onboarding.** `platform_admin` creates restaurants and assigns
  owners manually via the API. A real onboarding flow (signup → restaurant creation → owner
  role granted automatically) is future work.
- **`apps/admin` is routing + role-gating only** — every page is a placeholder. Building real
  dashboard UI before the underlying data model (categories, products, modifiers, delivery
  zones, promotions, staff invites) exists would mean building it twice.
- **BullMQ and Socket.IO are proven-working infrastructure, not features.** One demo job, no
  business events. They get used as each feature that needs async work or real-time push is
  actually built.
- **File storage is configured but unused** — no feature needs uploads yet (menu items still use
  a plain `imageUrl` string).

## Suggested next phase

Given the existing MVP already has working ordering + loyalty, the natural next phase is: wire
`apps/web`'s existing checkout flow to the new tenant-scoped routes end-to-end in the browser
(it's been updated to call them, but hasn't been click-tested since the restructure — see the
Phase 0 completion report), then pick one of:
1. **Restaurant onboarding + menu management UI in `apps/admin`** — makes the platform usable by
   an actual restaurant owner instead of only via direct API calls.
2. **CRM layer** (customer 360, segmentation, support tickets) on top of the existing
   order/loyalty data — this was the original MVP's planned "phase 2".

Either is reasonable; which one depends on whether the near-term goal is "onboard a real
restaurant" or "build out the CRM value proposition." Recommend deciding explicitly before
starting rather than drifting into both at once — see the original MVP's phasing rationale.
