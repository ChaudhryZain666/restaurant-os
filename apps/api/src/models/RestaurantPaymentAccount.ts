import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Restaurant-owned payment accounts (BYOC — "bring your own credentials"). Lets a restaurant
 * connect its OWN Stripe or Safepay account instead of using the platform's pooled default (see
 * payments/eligibility.ts) — money then settles directly into that restaurant's own account. A
 * separate collection, not a Restaurant subdocument, mirroring DomainMapping.ts's exact precedent:
 * keeps encrypted secrets off the frequently-fetched Restaurant document and gives this its own
 * verification lifecycle. Scoped per LOCATION (`restaurantId`), not per business — a multi-location
 * business can connect a different account per location if it wants to, same granularity
 * DomainMapping already uses for custom domains.
 *
 * `encryptedCredentials` is an AES-256-GCM envelope (see utils/credentialEncryption.ts) — never
 * queried or indexed on, only decrypted at the exact point of use (restaurantProvider.ts). Never
 * present in any API response: the toJSON transform below strips it unconditionally, the same
 * standard User.ts already holds passwordHash to.
 *
 * `status` has no "verified" stage the way DomainMapping does — DNS propagation creates a real time
 * gap between "provably yours" and "ready to cut over" that has no equivalent here, so connecting
 * an account synchronously verifies and activates it in one step (see restaurantProvider.ts).
 * `disconnected` is a soft transition, never a delete — refundPayment needs a disconnected
 * account's credentials to stay resolvable for as long as its original charges might still need
 * refunding.
 *
 * Phase 37 — `connectionMode` distinguishes HOW this account authorizes, on top of the existing
 * `provider` field (WHICH provider). Researched against each provider's current official docs, not
 * assumed: Stripe supports real platform-native connection (Connect, v1 Standard accounts, Direct
 * Charges) — a restaurant's own secret key is never collected or stored for `platform_connect`
 * accounts; the platform's own STRIPE_SECRET_KEY plus the stored `connectedAccountId` (via a
 * `Stripe-Account` header — see StripeProvider.ts) is all that's needed. Safepay's current docs
 * (safepay-docs.netlify.app) confirm no marketplace/OAuth/sub-merchant/central-webhook capability
 * exists at all — `merchant_credentials` (the pre-Phase-37 encrypted-secret-key flow, unchanged) is
 * genuinely the only option there, not a design shortcut.
 * `status` for a `platform_connect` account additionally uses "action_required" — the account
 * exists but Stripe's own `charges_enabled` is still false (onboarding incomplete or a new
 * requirement appeared) — tracked centrally via the `account.updated` Connect webhook event,
 * never inferred client-side.
 */
const restaurantPaymentAccountSchema = new Schema(
  {
    // No field-level index:true here — the partial unique index below already indexes
    // restaurantId (mirrors DomainMapping.ts's identical locationId precedent exactly; a separate
    // plain index here would just duplicate it, per that file's own comment on this trap).
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    provider: { type: String, enum: ["stripe", "safepay"], required: true },
    // Phase 37 — default "merchant_credentials" so any pre-existing dev-seeded row (all created
    // before this field existed, all necessarily the manual-credential flow) still reads as valid
    // with no backfill script needed — there is no real production data to migrate yet.
    connectionMode: {
      type: String,
      enum: ["platform_connect", "merchant_credentials"],
      default: "merchant_credentials",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending_verification", "active", "action_required", "invalid", "disconnected"],
      default: "pending_verification",
      required: true,
    },
    // platform_connect only — Stripe's own connected-account id (acct_...). Not a secret; safe to
    // return to the frontend and to log.
    connectedAccountId: { type: String },
    // platform_connect only — mirrored locally from Stripe's account.updated events (see
    // paymentWebhook.controller.ts's handleStripeConnectWebhook) so the UI never has to guess
    // real capability from a bare "connected" boolean.
    chargesEnabled: { type: Boolean },
    payoutsEnabled: { type: Boolean },
    requirementsDue: { type: [String], default: undefined },
    disabledReason: { type: String },
    // merchant_credentials only from Phase 37 onward — required on the schema pre-Phase-37, now
    // optional since a platform_connect account never collects or stores a secret at all.
    encryptedCredentials: {
      ciphertext: { type: String },
      iv: { type: String },
      authTag: { type: String },
      keyVersion: { type: Number },
    },
    // Display-safe, never reversible — e.g. "sk_test_····4242" — lets the settings page show
    // "which key is connected" without ever storing or returning anything that could be replayed.
    // merchant_credentials only.
    credentialFingerprint: { type: String },
    lastVerifiedAt: { type: Date },
    // Generic/safe message only — never the raw provider error body, which can echo back
    // fragments of the submitted key in some providers' validation error responses.
    lastVerificationError: { type: String },
    connectedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Phase 35 audit fix — `status: "active"` is set the moment verifyCredentials() succeeds
    // (restaurantPaymentAccount.controller.ts), which only proves the API key authenticates, never
    // that the owner actually finished configuring a webhook in their own provider dashboard. This
    // field is set once, the first time handleRestaurantAccountWebhook (paymentWebhook.controller.ts)
    // successfully verifies a REAL signed event for this account — never on connect, never faked.
    // Until it's set, the settings UI shows "awaiting webhook confirmation" rather than a bare
    // "Active" badge that would overstate readiness. See payment.service.ts's
    // reconcileStalePayments for the other half of closing this gap (a payment doesn't stay
    // silently unpaid forever even if a webhook is never configured at all).
    firstWebhookReceivedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      ...idTransform,
      transform(doc, ret) {
        idTransform.transform(doc, ret as Record<string, unknown>);
        delete (ret as Record<string, unknown>).encryptedCredentials;
        return ret;
      },
    },
  }
);

// At most one ACTIVE account per restaurant — a real DB constraint, not just application
// discipline, so a race between two "connect" requests can never leave two live accounts for the
// same restaurant. Also structurally rules out two providers being simultaneously active for one
// restaurant. A pending_verification/invalid row is still allowed to coexist with the currently
// active one (the reconnect/replace flow), same as DomainMapping's equivalent index.
restaurantPaymentAccountSchema.index({ restaurantId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

export type RestaurantPaymentAccountDoc = InferSchemaType<typeof restaurantPaymentAccountSchema>;
export const RestaurantPaymentAccount = model<RestaurantPaymentAccountDoc>(
  "RestaurantPaymentAccount",
  restaurantPaymentAccountSchema
);
