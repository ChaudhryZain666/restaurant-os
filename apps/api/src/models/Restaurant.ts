import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

// Enum values are inlined here (not imported from @restaurant/types) because Mongoose's
// InferSchemaType has previously failed to narrow a schema's fields (falling back to `unknown`
// across the WHOLE schema, not just the enum field) when an `enum:` array came from another
// package — see apps/api/src/models/User.ts's history. Inline literal arrays are the
// known-working pattern used throughout this codebase's other models.
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

// Phase 28 — evaluated in delivery.service.ts by picking the tier with the SMALLEST maxDistanceKm
// that still covers the order's actual distance, so entry order in this array never matters.
const deliveryFeeTierSchema = new Schema(
  {
    maxDistanceKm: { type: Number, required: true, min: 0.1 },
    fee: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const businessHoursDaySchema = new Schema(
  {
    day: { type: String, enum: WEEKDAYS, required: true },
    isClosed: { type: Boolean, default: false },
    open: { type: String },
    close: { type: String },
  },
  { _id: false }
);

// Phase 31 — see packages/types/src/types/theme.ts for the full doc comment on why this is
// deliberately small/closed (never a free-form style blob). Same inline-enum convention as
// WEEKDAYS above. `sections` is modeled as explicit optional booleans (not Schema.Types.Mixed) so
// an unrecognized key can never silently persist — Zod (packages/validation/src/theme.ts) is the
// primary gate, but the schema itself stays strict too.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Phase 33 — widened to add the five current theme keys (cinematic/luxury/contemporary/urban/
// minimal) while keeping the three original keys (classic/modern/editorial) permanently valid: this
// array is the Mongoose enum gate, so removing one of them here would fail ANY save (even an
// unrelated color-only draft edit) on a restaurant that still has that value persisted. There is no
// alias/remapping mechanism — each of the eight keys renders as itself via
// apps/web/src/theme/registry.tsx. `classic` is also this platform's protected default theme (see
// registry.tsx's DEFAULT_THEME_KEY) and, as of Phase 41, a real selectable entry in the admin
// Theme Studio catalog again (apps/admin/src/lib/themeCatalog.ts).
// Deliberately NOT importing @restaurant/types' THEME_KEYS here — matches this file's pre-existing
// duplication of that list, kept manually in sync rather than refactored in this phase.
const THEME_KEYS = ["classic", "modern", "editorial", "cinematic", "luxury", "contemporary", "urban", "minimal"] as const;
const THEME_RADIUS_SCALES = ["sharp", "soft", "rounded"] as const;
const THEME_DENSITIES = ["compact", "comfortable", "spacious"] as const;

const themeColorOverridesSchema = new Schema(
  {
    primary: { type: String, match: HEX_COLOR },
    secondary: { type: String, match: HEX_COLOR },
    accent: { type: String, match: HEX_COLOR },
    background: { type: String, match: HEX_COLOR },
  },
  { _id: false }
);

const themeSectionVisibilitySchema = new Schema(
  {
    hero: { type: Boolean },
    featured: { type: Boolean },
    about: { type: Boolean },
    gallery: { type: Boolean },
    cta: { type: Boolean },
  },
  { _id: false }
);

const themeConfigSchema = new Schema(
  {
    themeKey: { type: String, enum: THEME_KEYS, required: true, default: "classic" },
    themeVersion: { type: Number, required: true, default: 1 },
    // Explicit sub-schemas with their own default (not a plain nested object literal) — without
    // this, an "empty" colors/sections with no fields actually set serializes as `undefined` and
    // vanishes from the JSON response entirely, rather than the `{}` the TS contract
    // (RestaurantThemeConfig) and every client-side consumer expects to always be there.
    colors: { type: themeColorOverridesSchema, default: () => ({}) },
    radius: { type: String, enum: THEME_RADIUS_SCALES },
    density: { type: String, enum: THEME_DENSITIES },
    sections: { type: themeSectionVisibilitySchema, default: () => ({}) },
  },
  { _id: false }
);

const restaurantSettingsSchema = new Schema(
  {
    currency: { type: String, default: "USD" },
    timezone: { type: String, default: "UTC" },
    orderingEnabled: { type: Boolean, default: true },
    pickupEnabled: { type: Boolean, default: true },
    deliveryEnabled: { type: Boolean, default: false },
    dineInEnabled: { type: Boolean, default: false },
    // Payment methods offered to customers. There is deliberately no per-restaurant provider
    // credential field here — see docs/payment-provider-decision.md's "Restaurant payment
    // configuration" section: this platform uses one platform-owned payment-provider account
    // (selected via the server-only PAYMENT_PROVIDER env var), and onlinePaymentEnabled is purely
    // a per-restaurant opt-in/opt-out toggle on top of it, never a place secrets are stored.
    cashEnabled: { type: Boolean, default: true },
    onlinePaymentEnabled: { type: Boolean, default: false },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 1 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    // Straight-line (Haversine) radius from the restaurant's own latitude/longitude — see
    // docs/delivery-architecture.md. No default: undefined means "not configured," distinct from
    // 0 (which would mean "only deliver to this exact point").
    deliveryRadiusKm: { type: Number, min: 0.1, max: 100 },
    // Phase 28 — optional distance-tiered pricing, layered on top of the flat deliveryFee above
    // (used as a fallback when this is unset/empty). See deliveryFeeTierSchema's own comment.
    deliveryFeeTiers: { type: [deliveryFeeTierSchema], default: [] },
    businessHours: { type: [businessHoursDaySchema], default: [] },
    temporarilyPaused: { type: Boolean, default: false },
    pausedReason: { type: String, maxlength: 200 },
    // Purely presentational (storefront primary color override) — see ThemeProvider in apps/web.
    // Validated server-side as a strict 6-digit hex pattern (packages/validation), so this can
    // never carry anything beyond a color.
    brandColor: { type: String, maxlength: 7 },
    // Phase 28 — restaurant-level feature toggles, exact precedent of dineInEnabled/deliveryEnabled
    // above: a boolean that hides the corresponding nav/route (Layout.tsx's itemVisible, App.tsx's
    // RequireAuth) on top of existing permission checks, never deletes any underlying data. Turning
    // either back on restores full functionality immediately — nothing is destroyed when disabled.
    kitchenEnabled: { type: Boolean, default: true },
    staffEnabled: { type: Boolean, default: true },
    // POS phase — same opt-in-off-by-default precedent as dineInEnabled above: a restaurant must
    // explicitly turn the staff POS terminal on before restaurant.pos.operate-permitted staff can
    // ring up an order with it, even though the permission alone would otherwise allow it. See
    // docs/pos-architecture.md.
    posEnabled: { type: Boolean, default: false },
    // Phase 31 — the PUBLISHED theme configuration; always present (defaults to plain "classic",
    // no overrides) so every existing restaurant gets a real, valid theme with zero migration.
    theme: { type: themeConfigSchema, default: () => ({}) },
  },
  { _id: false }
);

const restaurantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String },
    logo: { type: String },
    coverImage: { type: String },
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    postalCode: { type: String },
    // Entered manually, or resolved via the LocationIQ-backed geocoding autocomplete (Phase 10 —
    // see services/geocoding/). Kept as plain numbers, not GeoJSON, since nothing here does
    // proximity queries; that's a reason to migrate later, not a reason to build it now.
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
    settings: { type: restaurantSettingsSchema, default: () => ({}) },
    // Phase 18 — a Restaurant is a physical location; Business is the owning brand/commercial
    // entity that can have more than one. Every Restaurant gets one via migration
    // (migrateToBusinessLocation.ts) or via createRestaurant going forward, so it's required in
    // practice — but NOT `required: true` at the schema level, so a not-yet-migrated document
    // (mid-rollout) can still be read/written without a validation error.
    businessId: { type: Schema.Types.ObjectId, ref: "Business", index: true },
    // Phase 31 — unpublished theme edits. No default (undefined = "no draft yet, published config
    // is current") so a restaurant that's never touched the Theme Studio carries zero extra state.
    // Never included on the public (unauthenticated) storefront response — see
    // restaurant.controller.ts's toPublicRestaurant/previewRestaurantBySlug.
    themeDraft: { type: themeConfigSchema },
    // Phase 41 — a one-deep snapshot of whatever settings.theme held immediately before the most
    // recent publish, written by publishTheme right before it overwrites settings.theme. This is
    // what makes "publish is reversible" a real one-click action (POST .../theme/rollback) instead
    // of "re-select the old theme and publish again" — the mission's own explicit distinction. No
    // default, same reasoning as themeDraft: undefined means "nothing has ever been published for
    // this restaurant yet, there is nothing to roll back to." Also never included on the public
    // storefront response, for the same reason themeDraft isn't.
    themePreviousPublished: { type: themeConfigSchema },
  },
  { timestamps: true, toJSON: idTransform }
);

export type RestaurantDoc = InferSchemaType<typeof restaurantSchema>;
export const Restaurant = model<RestaurantDoc>("Restaurant", restaurantSchema);
