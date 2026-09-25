import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 78 — the CSRF/replay-safety anchor for a restaurant-facing marketplace OAuth connect flow
 * (Uber Eats today; DoorDash if/when its own real merchant-facing flow becomes buildable — see
 * marketplaceProviders/DoorDashProvider.ts's own header comment). Never persisted anywhere else: an
 * OAuth `state` param has no natural owning document (the integration it will eventually produce
 * doesn't exist yet when the flow starts), unlike password-reset/staff-invite tokens which live as
 * fields on the User/staff document they belong to.
 *
 * Only the SHA-256 hash of the state value is stored (reuses secureToken.service.ts's exact
 * hash-only-persisted convention) — a database read never yields a usable state value. The real
 * defense against CSRF/account-linking-injection is `userId`: an attacker can mint their OWN valid
 * state (bound to their own restaurant), but replaying it against a victim's authenticated session
 * fails the `doc.userId === req.user.id` check the callback controller runs, even though the raw
 * token itself "checks out." `consumedAt` makes every state single-use — set atomically by
 * `consumeOAuthConnectState`'s findOneAndUpdate, so a duplicate/replayed callback can never consume
 * the same state twice, mirroring MarketplaceWebhookEvent's own atomic-claim idempotency shape.
 *
 * No TTL index — matches this codebase's existing convention (password-reset/staff-invite tokens
 * also have no TTL index; expiry is enforced only by query filter, confirmed via a repo-wide grep for
 * `expireAfterSeconds`). A short-lived best-effort cleanup sweep is not required for correctness: an
 * expired, unconsumed row is simply inert forever after `expiresAt` passes.
 */
const oauthConnectStateSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    // Only OAuth-shaped providers ever mint one of these — currently just Uber Eats.
    provider: { type: String, enum: ["uber_eats"], required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    // Who initiated the connect flow — cross-checked on consume against the authenticated caller of
    // the callback. This, not the state value alone, is what actually defeats CSRF.
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // The exact redirect_uri sent to the provider's authorize endpoint — re-sent verbatim at token
    // exchange, per OAuth's own requirement that it match on both calls.
    redirectUri: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
    // Multi-store picker support: populated only after a successful token exchange when store
    // discovery returns more than one candidate — never populated for the common single-store case,
    // which finalizes immediately instead. Absent (`undefined`) rather than an empty array otherwise.
    pendingCandidateStores: { type: [{ externalStoreId: String, displayName: String }], default: undefined },
    // `default: undefined` — without it, Mongoose auto-initializes a single-nested-subdocument path
    // to an empty (but non-undefined) subdocument instance on every document, which then breaks a
    // plain `=== undefined`/`toEqual(undefined)` check downstream (confirmed while writing this
    // file's own service test).
    pendingEncryptedCredentials: {
      type: {
        ciphertext: { type: String },
        iv: { type: String },
        authTag: { type: String },
        keyVersion: { type: Number },
      },
      default: undefined,
    },
    // Display-safe, never reversible — same fingerprint-not-secret pattern every other
    // credential-bearing model in this codebase uses. Computed once (from the raw token, before it's
    // encrypted away) and carried alongside pendingEncryptedCredentials so the store-picker follow-up
    // never needs the raw token again.
    pendingCredentialFingerprint: { type: String },
  },
  {
    timestamps: true,
    toJSON: idTransform,
  }
);

oauthConnectStateSchema.index({ tokenHash: 1 }, { unique: true });
// Query-filter-enforced expiry (see header comment) — an index here is a performance aid for the
// consume lookup's {expiresAt: {$gt: now}} clause, not a correctness mechanism.
oauthConnectStateSchema.index({ expiresAt: 1 });

export type OAuthConnectStateDoc = InferSchemaType<typeof oauthConnectStateSchema> & { _id: Types.ObjectId };
export const OAuthConnectState = model<OAuthConnectStateDoc>("OAuthConnectState", oauthConnectStateSchema);
