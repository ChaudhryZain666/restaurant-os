/**
 * DTO for a restaurant's own connected payment account (BYOC —
 * apps/api/src/models/RestaurantPaymentAccount.ts). Never carries the encrypted credential
 * envelope itself — only a display-safe, non-reversible `credentialFingerprint`.
 */

export type RestaurantPaymentAccountProvider = "stripe" | "safepay";
export type RestaurantPaymentAccountStatus = "pending_verification" | "active" | "action_required" | "invalid" | "disconnected";
// Phase 37 — platform_connect (Stripe Connect, no restaurant secret ever collected) vs
// merchant_credentials (Safepay's only option — see connectRestaurantPaymentAccountSchema's
// header comment for why, confirmed against Safepay's current official docs).
export type RestaurantPaymentAccountConnectionMode = "platform_connect" | "merchant_credentials";

export interface RestaurantPaymentAccount {
  id: string;
  restaurantId: string;
  businessId: string;
  provider: RestaurantPaymentAccountProvider;
  connectionMode: RestaurantPaymentAccountConnectionMode;
  status: RestaurantPaymentAccountStatus;
  // merchant_credentials (Safepay) only.
  credentialFingerprint?: string;
  // platform_connect (Stripe) only — not a secret, Stripe's own connected-account id.
  connectedAccountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  requirementsDue?: string[];
  disabledReason?: string;
  lastVerifiedAt?: string;
  lastVerificationError?: string;
  // Phase 35 audit fix — set only once a real, signature-verified webhook has actually arrived for
  // this account; absent means credentials were validated at connect time but the owner may not
  // have finished configuring their provider dashboard's webhook yet (merchant_credentials only —
  // a platform_connect account's webhook is centralized, see paymentWebhook.controller.ts's
  // handleStripeConnectWebhook, and never needs this per-account confirmation at all).
  firstWebhookReceivedAt?: string;
  connectedByUserId: string;
  createdAt: string;
  updatedAt: string;
}
